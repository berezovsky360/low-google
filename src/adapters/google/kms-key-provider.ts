import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import { CiphertextIntegrityError } from '../../domain/errors';
import type { KeyProvider } from '../../ports/interfaces';

/**
 * Production Google Cloud KMS implementation of KeyProvider.
 * Wraps and unwraps per-organization 256-bit AES-GCM data keys using
 * the configured Cloud KMS symmetric key and Additional Authenticated Data.
 */
export class CloudKmsKeyProvider implements KeyProvider {
  public readonly kmsKeyName: string;
  private readonly client: KeyManagementServiceClient;

  constructor(kmsKeyName?: string, client?: KeyManagementServiceClient) {
    const resolvedKeyName = kmsKeyName ?? process.env.LOW_KMS_KEY_NAME;
    if (!resolvedKeyName) {
      throw new Error('LOW_KMS_KEY_NAME environment variable is required');
    }
    this.kmsKeyName = resolvedKeyName;
    this.client = client ?? new KeyManagementServiceClient();
  }

  async wrapKey(plainKey: Buffer, aad: string): Promise<string> {
    const [result] = await this.client.encrypt({
      name: this.kmsKeyName,
      plaintext: plainKey,
      additionalAuthenticatedData: Buffer.from(aad, 'utf8'),
    });
    if (!result.ciphertext) {
      throw new Error('Cloud KMS failed to return ciphertext when wrapping key');
    }
    return Buffer.from(result.ciphertext).toString('base64');
  }

  async unwrapKey(wrappedKeyBase64: string, aad: string): Promise<Buffer> {
    try {
      const [result] = await this.client.decrypt({
        name: this.kmsKeyName,
        ciphertext: Buffer.from(wrappedKeyBase64, 'base64'),
        additionalAuthenticatedData: Buffer.from(aad, 'utf8'),
      });
      if (!result.plaintext) {
        throw new CiphertextIntegrityError('Cloud KMS returned empty plaintext key');
      }
      return Buffer.from(result.plaintext);
    } catch (err) {
      if (err instanceof CiphertextIntegrityError) {
        throw err;
      }
      throw new CiphertextIntegrityError(
        `Failed to unwrap organization data key with Cloud KMS: ${(err as Error).message}`
      );
    }
  }
}

/**
 * Local development / emulator KeyProvider that performs real AES-256-GCM
 * key wrapping with AAD when running against the local Firebase Emulator Suite.
 */
export class LocalKmsEmulatorKeyProvider implements KeyProvider {
  public readonly kmsKeyName: string;
  private readonly kek: Buffer;

  constructor(
    kmsKeyName = process.env.LOW_KMS_KEY_NAME ??
      'projects/local-emulator/locations/local/keyRings/low/cryptoKeys/data',
    masterSecret = process.env.LOW_LOCAL_KEK_SECRET ?? 'low-emulator-master-kek-secret-32b'
  ) {
    this.kmsKeyName = kmsKeyName;
    this.kek = createHash('sha256').update(masterSecret, 'utf8').digest();
  }

  async wrapKey(plainKey: Buffer, aad: string): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.kek, iv, {
      authTagLength: 16,
    });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plainKey), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  async unwrapKey(wrappedKeyBase64: string, aad: string): Promise<Buffer> {
    try {
      const packed = Buffer.from(wrappedKeyBase64, 'base64');
      const iv = packed.subarray(0, 12);
      const tag = packed.subarray(12, 28);
      const encrypted = packed.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', this.kek, iv, {
        authTagLength: 16,
      });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } catch {
      throw new CiphertextIntegrityError('Failed to unwrap organization key (AAD or KEK mismatch)');
    }
  }
}

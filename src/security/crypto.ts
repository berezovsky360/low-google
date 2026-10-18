import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { CiphertextIntegrityError } from '../domain/errors';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;

export function generateDataKey(): Buffer {
  return randomBytes(KEY_LENGTH_BYTES);
}

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function buildDocumentAad(orgId: string, documentId: string): string {
  if (!orgId || !documentId) {
    throw new Error('Both orgId and documentId are required to build AAD');
  }
  return `${orgId}/${documentId}`;
}

/**
 * Encrypts a UTF-8 Markdown body under an organization's 256-bit data key using
 * AES-256-GCM, binding the ciphertext to `orgId/documentId` via Additional
 * Authenticated Data (AAD).
 *
 * Output wire format (Base64): [12-byte IV][16-byte GCM Auth Tag][Ciphertext]
 */
export function encryptBody(params: {
  plainText: string;
  dataKey: Buffer;
  orgId: string;
  documentId: string;
}): string {
  const { plainText, dataKey, orgId, documentId } = params;
  if (dataKey.byteLength !== KEY_LENGTH_BYTES) {
    throw new Error(`Invalid AES-256 key length: ${dataKey.byteLength}`);
  }

  const aad = Buffer.from(buildDocumentAad(orgId, documentId), 'utf8');
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, dataKey, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  cipher.setAAD(aad);

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypts a Base64 AES-256-GCM payload, verifying the authentication tag
 * against `orgId/documentId` AAD. Any tampering or cross-tenant/cross-document
 * copy throws CiphertextIntegrityError.
 */
export function decryptBody(params: {
  ciphertextBase64: string;
  dataKey: Buffer;
  orgId: string;
  documentId: string;
}): string {
  const { ciphertextBase64, dataKey, orgId, documentId } = params;
  if (dataKey.byteLength !== KEY_LENGTH_BYTES) {
    throw new Error(`Invalid AES-256 key length: ${dataKey.byteLength}`);
  }

  let packed: Buffer;
  try {
    packed = Buffer.from(ciphertextBase64, 'base64');
  } catch {
    throw new CiphertextIntegrityError('Invalid base64 ciphertext');
  }

  if (packed.byteLength < IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES) {
    throw new CiphertextIntegrityError('Ciphertext buffer is truncated');
  }

  const iv = packed.subarray(0, IV_LENGTH_BYTES);
  const authTag = packed.subarray(
    IV_LENGTH_BYTES,
    IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES
  );
  const encrypted = packed.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

  const aad = Buffer.from(buildDocumentAad(orgId, documentId), 'utf8');

  try {
    const decipher = createDecipheriv(ALGORITHM, dataKey, iv, {
      authTagLength: AUTH_TAG_LENGTH_BYTES,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    throw new CiphertextIntegrityError(
      `Failed to decrypt body for ${orgId}/${documentId}: AAD mismatch, wrong key, or tampered ciphertext`
    );
  }
}

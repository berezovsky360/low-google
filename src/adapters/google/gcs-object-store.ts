import { Storage } from '@google-cloud/storage';
import { TenantIsolationError } from '../../domain/errors';
import type { ObjectStore } from '../../ports/interfaces';

export class CloudStorageObjectStore implements ObjectStore {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(bucketName?: string, storage?: Storage) {
    const resolvedBucket = bucketName ?? process.env.LOW_STORAGE_BUCKET;
    if (!resolvedBucket) {
      throw new Error('LOW_STORAGE_BUCKET environment variable is required');
    }
    this.bucketName = resolvedBucket;
    this.storage = storage ?? new Storage();
  }

  private scopedKey(orgId: string, path: string): string {
    if (!orgId || orgId.includes('/')) {
      throw new TenantIsolationError('Invalid orgId for Cloud Storage path');
    }
    const cleanPath = path.replace(/^\/+/, '');
    if (cleanPath.includes('..')) {
      throw new TenantIsolationError('Path traversal prohibited');
    }
    return `organizations/${orgId}/${cleanPath}`;
  }

  async putObject(params: {
    orgId: string;
    path: string;
    data: Buffer;
    contentType: string;
  }): Promise<{ uri: string; sizeBytes: number }> {
    const key = this.scopedKey(params.orgId, params.path);
    const file = this.storage.bucket(this.bucketName).file(key);
    await file.save(params.data, {
      contentType: params.contentType,
      resumable: false,
    });
    return {
      uri: `gs://${this.bucketName}/${key}`,
      sizeBytes: params.data.byteLength,
    };
  }

  async getObject(params: { orgId: string; path: string }): Promise<Buffer> {
    const key = this.scopedKey(params.orgId, params.path);
    const [contents] = await this.storage
      .bucket(this.bucketName)
      .file(key)
      .download();
    return contents;
  }

  async deleteObject(params: { orgId: string; path: string }): Promise<void> {
    const key = this.scopedKey(params.orgId, params.path);
    await this.storage.bucket(this.bucketName).file(key).delete({ ignoreNotFound: true });
  }
}

export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, { data: Buffer; contentType: string }>();

  private scopedKey(orgId: string, path: string): string {
    if (!orgId || orgId.includes('/')) {
      throw new TenantIsolationError('Invalid orgId');
    }
    return `organizations/${orgId}/${path.replace(/^\/+/, '')}`;
  }

  async putObject(params: {
    orgId: string;
    path: string;
    data: Buffer;
    contentType: string;
  }): Promise<{ uri: string; sizeBytes: number }> {
    const key = this.scopedKey(params.orgId, params.path);
    this.objects.set(key, {
      data: Buffer.from(params.data),
      contentType: params.contentType,
    });
    return {
      uri: `mem://low-bucket/${key}`,
      sizeBytes: params.data.byteLength,
    };
  }

  async getObject(params: { orgId: string; path: string }): Promise<Buffer> {
    const key = this.scopedKey(params.orgId, params.path);
    const entry = this.objects.get(key);
    if (!entry) {
      throw new Error(`Object not found: ${key}`);
    }
    return Buffer.from(entry.data);
  }

  async deleteObject(params: { orgId: string; path: string }): Promise<void> {
    const key = this.scopedKey(params.orgId, params.path);
    this.objects.delete(key);
  }
}

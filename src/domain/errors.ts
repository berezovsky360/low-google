export class TenantIsolationError extends Error {
  public readonly code = 'TENANT_ISOLATION_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

export class VersionConflictError extends Error {
  public readonly code = 'VERSION_CONFLICT';
  public readonly expectedVersion: number;
  public readonly actualVersion: number;

  constructor(docId: string, expectedVersion: number, actualVersion: number) {
    super(
      `Conflict on ${docId}: expected version ${expectedVersion}, but actual version is ${actualVersion}`
    );
    this.name = 'VersionConflictError';
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class ApprovalVerificationError extends Error {
  public readonly code = 'APPROVAL_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalVerificationError';
  }
}

export class CiphertextIntegrityError extends Error {
  public readonly code = 'CIPHERTEXT_INTEGRITY_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'CiphertextIntegrityError';
  }
}

export class NotFoundError extends Error {
  public readonly code = 'NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

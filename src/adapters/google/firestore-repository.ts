import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore, type Transaction } from 'firebase-admin/firestore';
import {
  ApprovalVerificationError,
  NotFoundError,
  TenantIsolationError,
  VersionConflictError,
} from '../../domain/errors';
import {
  parseMarkdownToRecord,
  serializeRecordToMarkdown,
} from '../../domain/markdown-records';
import {
  AppDefinitionSchema,
  ApprovalSchema,
  AppSchema,
  AppSnapshotSchema,
  ArchiveDocumentInputSchema,
  AuditEventSchema,
  ChunkSchema,
  CreateDocumentInputSchema,
  DecryptedAppRecordSchema,
  DecryptedDocumentSchema,
  DecryptedDocumentVersionSchema,
  KnowledgeCollectionSchema,
  MemberSchema,
  MoveDocumentInputSchema,
  OrganizationSchema,
  OrgKeySchema,
  RestoreDocumentInputSchema,
  RunSchema,
  StoredAppRecordSchema,
  StoredDocumentSchema,
  StoredDocumentVersionSchema,
  StoredQueueItemSchema,
  UpdateDocumentInputSchema,
  VerifiedActorSchema,
  WorkflowDefinitionSchema,
  type App,
  type AppDefinition,
  type Approval,
  type AppSnapshot,
  type ArchiveDocumentInput,
  type AuditEvent,
  type Chunk,
  type ConsequentialActionType,
  type CreateDocumentInput,
  type DecryptedAppRecord,
  type DecryptedDocument,
  type DecryptedDocumentVersion,
  type KnowledgeCollection,
  type Member,
  type MoveDocumentInput,
  type Organization,
  type OrgKey,
  type RestoreDocumentInput,
  type Run,
  type StoredAppRecord,
  type StoredDocument,
  type StoredDocumentVersion,
  type StoredQueueItem,
  type UpdateDocumentInput,
  type VerifiedActor,
  type WorkflowDefinition,
} from '../../domain/schemas';
import type { DocumentStore, KeyProvider } from '../../ports/interfaces';
import { computeApprovalMac, verifyApprovalForExecution } from '../../security/approvals';
import { decryptBody, encryptBody, generateDataKey, sha256Hex } from '../../security/crypto';

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Principle 2: Single server repository module.
 *
 * This is the ONLY module in the codebase permitted to import `firebase-admin/firestore`.
 * Every operation requires a `VerifiedActor` (extracted from a verified token)
 * and scopes all Firestore paths strictly under `organizations/{actor.orgId}/...`.
 */
export class FirestoreRepository implements DocumentStore {
  private readonly db: Firestore;
  private readonly keyProvider: KeyProvider;
  private readonly approvalSecret: string;

  constructor(params: {
    keyProvider: KeyProvider;
    approvalSecret?: string;
    db?: Firestore;
  }) {
    this.keyProvider = params.keyProvider;
    this.approvalSecret =
      params.approvalSecret ??
      process.env.LOW_APPROVAL_SECRET ??
      'low-dev-approval-secret-must-be-at-least-16-bytes';

    if (params.db) {
      this.db = params.db;
    } else {
      if (getApps().length === 0) {
        initializeApp({
          projectId:
            process.env.FIREBASE_PROJECT_ID ??
            process.env.GOOGLE_CLOUD_PROJECT ??
            'demo-low-project',
        });
      }
      this.db = getFirestore();
    }
  }

  // ==========================================================================
  // Tenant Path Scoping Helpers (Always `organizations/{orgId}/...`)
  // ==========================================================================

  private assertActor(actor: VerifiedActor): VerifiedActor {
    const parsed = VerifiedActorSchema.safeParse(actor);
    if (!parsed.success) {
      throw new TenantIsolationError(
        `Invalid or missing VerifiedActor context: ${parsed.error.message}`
      );
    }
    if (parsed.data.orgId.includes('/')) {
      throw new TenantIsolationError('Invalid orgId path segment');
    }
    return parsed.data;
  }

  private orgRef(orgId: string) {
    if (!orgId || orgId.includes('/')) {
      throw new TenantIsolationError('Invalid orgId');
    }
    return this.db.collection('organizations').doc(orgId);
  }

  private membersCol(orgId: string) {
    return this.orgRef(orgId).collection('members');
  }

  private keysCol(orgId: string) {
    return this.orgRef(orgId).collection('keys');
  }

  private documentsCol(orgId: string) {
    return this.orgRef(orgId).collection('documents');
  }

  private versionsCol(orgId: string, docId: string) {
    return this.documentsCol(orgId).doc(docId).collection('versions');
  }

  private chunksCol(orgId: string) {
    return this.orgRef(orgId).collection('chunks');
  }

  private collectionsCol(orgId: string) {
    return this.orgRef(orgId).collection('collections');
  }

  private appsCol(orgId: string) {
    return this.orgRef(orgId).collection('apps');
  }

  private snapshotsCol(orgId: string, appId: string) {
    return this.appsCol(orgId).doc(appId).collection('snapshots');
  }

  private recordsCol(orgId: string, appId: string) {
    return this.appsCol(orgId).doc(appId).collection('records');
  }

  private approvalsCol(orgId: string) {
    return this.orgRef(orgId).collection('approvals');
  }

  private auditCol(orgId: string) {
    return this.orgRef(orgId).collection('audit');
  }

  private runsCol(orgId: string) {
    return this.orgRef(orgId).collection('runs');
  }

  private queueCol(orgId: string) {
    return this.orgRef(orgId).collection('queue');
  }

  private keyWrapAad(orgId: string, version: number): string {
    return `org:${orgId}:key-v:${version}`;
  }

  // ==========================================================================
  // Append-Only Audit Helper (Never exposes update or delete)
  // ==========================================================================

  private writeAuditInTransaction(
    tx: Transaction,
    orgId: string,
    event: Omit<AuditEvent, 'id' | 'createdAt'>
  ): AuditEvent {
    const id = randomUUID();
    const nowIso = new Date().toISOString();
    const record: AuditEvent = AuditEventSchema.parse({
      ...event,
      id,
      createdAt: nowIso,
    });
    const ref = this.auditCol(orgId).doc(id);
    tx.create(ref, record);
    return record;
  }

  // ==========================================================================
  // Per-Organization Envelope Key Provisioning & Unwrapping
  // ==========================================================================

  private async getOrProvisionActiveOrgKey(
    orgId: string
  ): Promise<{ version: number; plainKey: Buffer }> {
    const orgSnap = await this.orgRef(orgId).get();
    const activeVersion = orgSnap.exists
      ? ((orgSnap.data()?.activeKeyVersion as number | undefined) ?? 1)
      : 1;

    const keyRef = this.keysCol(orgId).doc(String(activeVersion));
    const keySnap = await keyRef.get();

    if (keySnap.exists) {
      const orgKey = OrgKeySchema.parse(keySnap.data());
      const plainKey = await this.keyProvider.unwrapKey(
        orgKey.wrappedKey,
        this.keyWrapAad(orgId, orgKey.version)
      );
      return { version: orgKey.version, plainKey };
    }

    const generatedKey = generateDataKey();
    const wrappedKey = await this.keyProvider.wrapKey(
      generatedKey,
      this.keyWrapAad(orgId, activeVersion)
    );
    const nowIso = new Date().toISOString();
    const newOrgKey: OrgKey = OrgKeySchema.parse({
      version: activeVersion,
      wrappedKey,
      kmsKeyName: this.keyProvider.kmsKeyName,
      createdAt: nowIso,
      retiredAt: null,
    });

    await this.db.runTransaction(async (tx) => {
      const existing = await tx.get(keyRef);
      if (!existing.exists) {
        tx.create(keyRef, newOrgKey);
      }
    });

    const finalSnap = await keyRef.get();
    const finalKey = OrgKeySchema.parse(finalSnap.data());
    const plainKey = await this.keyProvider.unwrapKey(
      finalKey.wrappedKey,
      this.keyWrapAad(orgId, finalKey.version)
    );
    return { version: finalKey.version, plainKey };
  }

  private async unwrapOrgKeyVersion(orgId: string, version: number): Promise<Buffer> {
    const keySnap = await this.keysCol(orgId).doc(String(version)).get();
    if (!keySnap.exists) {
      throw new NotFoundError(`Encryption key version ${version} not found for org ${orgId}`);
    }
    const orgKey = OrgKeySchema.parse(keySnap.data());
    return this.keyProvider.unwrapKey(
      orgKey.wrappedKey,
      this.keyWrapAad(orgId, orgKey.version)
    );
  }

  private async decryptStoredDocument(
    orgId: string,
    stored: StoredDocument,
    keyCache?: Map<number, Buffer>
  ): Promise<DecryptedDocument> {
    let body = '';
    if (stored.kind === 'file' && stored.bodyCiphertext.length > 0) {
      let dataKey = keyCache?.get(stored.keyVersion);
      if (!dataKey) {
        dataKey = await this.unwrapOrgKeyVersion(orgId, stored.keyVersion);
        keyCache?.set(stored.keyVersion, dataKey);
      }
      body = decryptBody({
        ciphertextBase64: stored.bodyCiphertext,
        dataKey,
        orgId,
        documentId: stored.id,
      });
    }

    return DecryptedDocumentSchema.parse({
      id: stored.id,
      kind: stored.kind,
      name: stored.name,
      parentId: stored.parentId,
      ancestors: stored.ancestors,
      body,
      keyVersion: stored.keyVersion,
      sha256: stored.sha256,
      sizeBytes: stored.sizeBytes,
      language: stored.language,
      version: stored.version,
      updatedAt: stored.updatedAt,
      deletedAt: stored.deletedAt,
    });
  }

  // ==========================================================================
  // Organization & Membership Operations
  // ==========================================================================

  async createOrganization(params: {
    orgId: string;
    name: string;
    ownerUid: string;
    ownerEmail?: string;
    ownerDisplayName?: string;
  }): Promise<Organization> {
    const { orgId, name, ownerUid, ownerEmail, ownerDisplayName } = params;
    if (!orgId || orgId.includes('/')) {
      throw new TenantIsolationError('Invalid orgId');
    }

    const nowIso = new Date().toISOString();
    const plainKey = generateDataKey();
    const wrappedKey = await this.keyProvider.wrapKey(
      plainKey,
      this.keyWrapAad(orgId, 1)
    );

    const orgRecord: Organization = OrganizationSchema.parse({
      id: orgId,
      name,
      createdBy: ownerUid,
      activeKeyVersion: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const keyRecord: OrgKey = OrgKeySchema.parse({
      version: 1,
      wrappedKey,
      kmsKeyName: this.keyProvider.kmsKeyName,
      createdAt: nowIso,
      retiredAt: null,
    });

    const memberRecord: Member = MemberSchema.parse({
      uid: ownerUid,
      role: 'owner',
      ...(ownerEmail ? { email: ownerEmail } : {}),
      ...(ownerDisplayName ? { displayName: ownerDisplayName } : {}),
      joinedAt: nowIso,
    });

    await this.db.runTransaction(async (tx) => {
      const orgDocRef = this.orgRef(orgId);
      const snap = await tx.get(orgDocRef);
      if (snap.exists) {
        return;
      }
      tx.create(orgDocRef, orgRecord);
      tx.create(this.keysCol(orgId).doc('1'), keyRecord);
      tx.create(this.membersCol(orgId).doc(ownerUid), memberRecord);
      this.writeAuditInTransaction(tx, orgId, {
        actor: ownerUid,
        action: 'organization.create',
        targetType: 'organization',
        targetId: orgId,
        appId: null,
        appVersion: null,
        metadata: { name },
      });
    });

    return orgRecord;
  }

  async getOrganization(actor: VerifiedActor): Promise<Organization | null> {
    const verified = this.assertActor(actor);
    const snap = await this.orgRef(verified.orgId).get();
    if (!snap.exists) {
      return null;
    }
    return OrganizationSchema.parse(snap.data());
  }

  async listMembers(actor: VerifiedActor): Promise<Member[]> {
    const verified = this.assertActor(actor);
    const snaps = await this.membersCol(verified.orgId).get();
    return snaps.docs.map((doc) => MemberSchema.parse(doc.data()));
  }

  // ==========================================================================
  // Step 1: Workspace Document Operations
  // ==========================================================================

  async createDocument(
    actor: VerifiedActor,
    rawInput: CreateDocumentInput
  ): Promise<DecryptedDocument> {
    const verified = this.assertActor(actor);
    const input = CreateDocumentInputSchema.parse(rawInput);
    const docId = input.id ?? randomUUID();

    if (docId.includes('/')) {
      throw new TenantIsolationError('Document ID cannot contain slashes');
    }

    const { version: keyVersion, plainKey } = await this.getOrProvisionActiveOrgKey(
      verified.orgId
    );

    const plainBody = input.kind === 'file' ? input.body : '';
    const bodyCiphertext =
      input.kind === 'file'
        ? encryptBody({
            plainText: plainBody,
            dataKey: plainKey,
            orgId: verified.orgId,
            documentId: docId,
          })
        : '';
    const sha256 = sha256Hex(plainBody);
    const sizeBytes = Buffer.byteLength(plainBody, 'utf8');
    const nowIso = new Date().toISOString();

    const storedDoc = await this.db.runTransaction(async (tx) => {
      const docRef = this.documentsCol(verified.orgId).doc(docId);
      const existing = await tx.get(docRef);
      if (existing.exists) {
        throw new VersionConflictError(docId, 0, (existing.data()?.version as number) ?? 1);
      }

      let ancestors: string[] = [];
      if (input.parentId !== null) {
        const parentRef = this.documentsCol(verified.orgId).doc(input.parentId);
        const parentSnap = await tx.get(parentRef);
        if (!parentSnap.exists) {
          throw new NotFoundError(`Parent folder ${input.parentId} does not exist`);
        }
        const parentDoc = StoredDocumentSchema.parse(parentSnap.data());
        if (parentDoc.kind !== 'folder') {
          throw new Error(`Parent document ${input.parentId} is not a folder`);
        }
        if (parentDoc.deletedAt !== null) {
          throw new Error(`Parent folder ${input.parentId} is archived`);
        }
        ancestors = [...parentDoc.ancestors, parentDoc.id];
      }

      const record: StoredDocument = StoredDocumentSchema.parse({
        id: docId,
        kind: input.kind,
        name: input.name,
        parentId: input.parentId,
        ancestors,
        bodyCiphertext,
        keyVersion,
        sha256,
        sizeBytes,
        language: input.language,
        version: 1,
        updatedAt: nowIso,
        deletedAt: null,
      });

      tx.create(docRef, record);

      if (input.kind === 'file') {
        const versionRecord: StoredDocumentVersion = StoredDocumentVersionSchema.parse({
          version: 1,
          bodyCiphertext,
          keyVersion,
          sha256,
          writtenBy: verified.uid,
          createdAt: nowIso,
        });
        tx.create(this.versionsCol(verified.orgId, docId).doc('1'), versionRecord);
      }

      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: `document.create.${input.kind}`,
        targetType: 'document',
        targetId: docId,
        appId: null,
        appVersion: null,
        metadata: {
          name: input.name,
          parentId: input.parentId,
          version: 1,
          sha256,
        },
      });

      return record;
    });

    const { bodyCiphertext: _omitted, ...restStored } = storedDoc;
    return DecryptedDocumentSchema.parse({
      ...restStored,
      body: plainBody,
    });
  }

  async getDocument(
    actor: VerifiedActor,
    docId: string
  ): Promise<DecryptedDocument | null> {
    const verified = this.assertActor(actor);
    const snap = await this.documentsCol(verified.orgId).doc(docId).get();
    if (!snap.exists) {
      return null;
    }
    const stored = StoredDocumentSchema.parse(snap.data());
    return this.decryptStoredDocument(verified.orgId, stored);
  }

  async getRawStoredDocument(
    actor: VerifiedActor,
    docId: string
  ): Promise<StoredDocument | null> {
    const verified = this.assertActor(actor);
    const snap = await this.documentsCol(verified.orgId).doc(docId).get();
    if (!snap.exists) {
      return null;
    }
    return StoredDocumentSchema.parse(snap.data());
  }

  async listDocuments(
    actor: VerifiedActor,
    options?: {
      parentId?: string | null;
      includeDeleted?: boolean;
    }
  ): Promise<DecryptedDocument[]> {
    const verified = this.assertActor(actor);
    const snaps = await this.documentsCol(verified.orgId).get();
    const keyCache = new Map<number, Buffer>();
    const results: DecryptedDocument[] = [];

    for (const docSnap of snaps.docs) {
      const stored = StoredDocumentSchema.parse(docSnap.data());
      if (!options?.includeDeleted && stored.deletedAt !== null) {
        continue;
      }
      if (options?.parentId !== undefined && stored.parentId !== options.parentId) {
        continue;
      }
      const decrypted = await this.decryptStoredDocument(verified.orgId, stored, keyCache);
      results.push(decrypted);
    }

    return results.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  async updateDocument(
    actor: VerifiedActor,
    rawInput: UpdateDocumentInput
  ): Promise<DecryptedDocument> {
    const verified = this.assertActor(actor);
    const input = UpdateDocumentInputSchema.parse(rawInput);

    const { version: activeKeyVersion, plainKey: activeKey } =
      await this.getOrProvisionActiveOrgKey(verified.orgId);

    const updated = await this.db.runTransaction(async (tx) => {
      const docRef = this.documentsCol(verified.orgId).doc(input.docId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        throw new NotFoundError(`Document ${input.docId} not found`);
      }

      const current = StoredDocumentSchema.parse(snap.data());
      if (current.version !== input.expectedVersion) {
        throw new VersionConflictError(
          input.docId,
          input.expectedVersion,
          current.version
        );
      }

      if (current.deletedAt !== null) {
        throw new Error(`Cannot update archived document ${input.docId}`);
      }

      const nextVersion = current.version + 1;
      const nowIso = new Date().toISOString();
      const nextName = input.name ?? current.name;
      const nextLanguage = input.language ?? current.language;

      let nextBodyCiphertext = current.bodyCiphertext;
      let nextKeyVersion = current.keyVersion;
      let nextSha256 = current.sha256;
      let nextSizeBytes = current.sizeBytes;
      let resolvedPlainBody = '';

      if (current.kind === 'file') {
        if (input.body !== undefined) {
          resolvedPlainBody = input.body;
          nextBodyCiphertext = encryptBody({
            plainText: resolvedPlainBody,
            dataKey: activeKey,
            orgId: verified.orgId,
            documentId: current.id,
          });
          nextKeyVersion = activeKeyVersion;
          nextSha256 = sha256Hex(resolvedPlainBody);
          nextSizeBytes = Buffer.byteLength(resolvedPlainBody, 'utf8');
        } else {
          const existingKey =
            current.keyVersion === activeKeyVersion
              ? activeKey
              : await this.unwrapOrgKeyVersion(verified.orgId, current.keyVersion);
          resolvedPlainBody = decryptBody({
            ciphertextBase64: current.bodyCiphertext,
            dataKey: existingKey,
            orgId: verified.orgId,
            documentId: current.id,
          });
        }
      }

      const nextRecord: StoredDocument = StoredDocumentSchema.parse({
        ...current,
        name: nextName,
        language: nextLanguage,
        bodyCiphertext: nextBodyCiphertext,
        keyVersion: nextKeyVersion,
        sha256: nextSha256,
        sizeBytes: nextSizeBytes,
        version: nextVersion,
        updatedAt: nowIso,
      });

      tx.set(docRef, nextRecord);

      if (current.kind === 'file') {
        const versionRecord: StoredDocumentVersion = StoredDocumentVersionSchema.parse({
          version: nextVersion,
          bodyCiphertext: nextBodyCiphertext,
          keyVersion: nextKeyVersion,
          sha256: nextSha256,
          writtenBy: verified.uid,
          createdAt: nowIso,
        });
        tx.create(
          this.versionsCol(verified.orgId, current.id).doc(String(nextVersion)),
          versionRecord
        );
      }

      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: 'document.update',
        targetType: 'document',
        targetId: current.id,
        appId: null,
        appVersion: null,
        metadata: {
          name: nextName,
          previousVersion: current.version,
          version: nextVersion,
          sha256: nextSha256,
        },
      });

      return { nextRecord, resolvedPlainBody };
    });

    const { bodyCiphertext: _omitted, ...restUpdated } = updated.nextRecord;
    return DecryptedDocumentSchema.parse({
      ...restUpdated,
      body: updated.resolvedPlainBody,
    });
  }

  async moveDocument(
    actor: VerifiedActor,
    rawInput: MoveDocumentInput
  ): Promise<DecryptedDocument> {
    const verified = this.assertActor(actor);
    const input = MoveDocumentInputSchema.parse(rawInput);

    if (input.targetParentId === input.docId) {
      throw new Error('Cannot move a folder into itself');
    }

    const moved = await this.db.runTransaction(async (tx) => {
      const docRef = this.documentsCol(verified.orgId).doc(input.docId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        throw new NotFoundError(`Document ${input.docId} not found`);
      }

      const current = StoredDocumentSchema.parse(snap.data());
      if (current.version !== input.expectedVersion) {
        throw new VersionConflictError(
          input.docId,
          input.expectedVersion,
          current.version
        );
      }

      let nextAncestors: string[] = [];
      if (input.targetParentId !== null) {
        const parentRef = this.documentsCol(verified.orgId).doc(input.targetParentId);
        const parentSnap = await tx.get(parentRef);
        if (!parentSnap.exists) {
          throw new NotFoundError(`Target folder ${input.targetParentId} not found`);
        }
        const parentDoc = StoredDocumentSchema.parse(parentSnap.data());
        if (parentDoc.kind !== 'folder') {
          throw new Error(`Target ${input.targetParentId} is not a folder`);
        }
        if (parentDoc.ancestors.includes(current.id)) {
          throw new Error('Cannot move a folder into one of its descendants');
        }
        nextAncestors = [...parentDoc.ancestors, parentDoc.id];
      }

      const nextVersion = current.version + 1;
      const nowIso = new Date().toISOString();
      const nextRecord: StoredDocument = StoredDocumentSchema.parse({
        ...current,
        parentId: input.targetParentId,
        ancestors: nextAncestors,
        version: nextVersion,
        updatedAt: nowIso,
      });

      tx.set(docRef, nextRecord);

      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: 'document.move',
        targetType: 'document',
        targetId: current.id,
        appId: null,
        appVersion: null,
        metadata: {
          fromParentId: current.parentId,
          toParentId: input.targetParentId,
          version: nextVersion,
        },
      });

      return nextRecord;
    });

    return this.decryptStoredDocument(verified.orgId, moved);
  }

  async archiveDocument(
    actor: VerifiedActor,
    rawInput: ArchiveDocumentInput
  ): Promise<DecryptedDocument> {
    const verified = this.assertActor(actor);
    const input = ArchiveDocumentInputSchema.parse(rawInput);

    const archived = await this.db.runTransaction(async (tx) => {
      const docRef = this.documentsCol(verified.orgId).doc(input.docId);
      const approvalRef = this.approvalsCol(verified.orgId).doc(input.approvalId);

      const [docSnap, approvalSnap] = await Promise.all([
        tx.get(docRef),
        tx.get(approvalRef),
      ]);

      if (!docSnap.exists) {
        throw new NotFoundError(`Document ${input.docId} not found`);
      }
      if (!approvalSnap.exists) {
        throw new ApprovalVerificationError(`Approval ${input.approvalId} not found`);
      }

      const current = StoredDocumentSchema.parse(docSnap.data());
      if (current.version !== input.expectedVersion) {
        throw new VersionConflictError(
          input.docId,
          input.expectedVersion,
          current.version
        );
      }

      const storedApproval = ApprovalSchema.parse(approvalSnap.data());
      verifyApprovalForExecution({
        secret: this.approvalSecret,
        storedApproval,
        orgId: verified.orgId,
        actorUid: verified.uid,
        expectedAction: 'archive_document',
        providedMac: input.requestMac,
        actualRequestPayload: {
          docId: input.docId,
          expectedVersion: input.expectedVersion,
        },
      });

      const nowIso = new Date().toISOString();
      const nextVersion = current.version + 1;

      tx.update(approvalRef, { used: true });

      const nextRecord: StoredDocument = StoredDocumentSchema.parse({
        ...current,
        version: nextVersion,
        updatedAt: nowIso,
        deletedAt: nowIso,
      });
      tx.set(docRef, nextRecord);

      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: 'document.archive',
        targetType: 'document',
        targetId: current.id,
        appId: null,
        appVersion: null,
        metadata: {
          approvalId: input.approvalId,
          version: nextVersion,
        },
      });

      return nextRecord;
    });

    return this.decryptStoredDocument(verified.orgId, archived);
  }

  async restoreDocument(
    actor: VerifiedActor,
    rawInput: RestoreDocumentInput
  ): Promise<DecryptedDocument> {
    const verified = this.assertActor(actor);
    const input = RestoreDocumentInputSchema.parse(rawInput);

    const restored = await this.db.runTransaction(async (tx) => {
      const docRef = this.documentsCol(verified.orgId).doc(input.docId);
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        throw new NotFoundError(`Document ${input.docId} not found`);
      }

      const current = StoredDocumentSchema.parse(snap.data());
      if (current.version !== input.expectedVersion) {
        throw new VersionConflictError(
          input.docId,
          input.expectedVersion,
          current.version
        );
      }

      const nowIso = new Date().toISOString();
      const nextVersion = current.version + 1;
      const nextRecord: StoredDocument = StoredDocumentSchema.parse({
        ...current,
        version: nextVersion,
        updatedAt: nowIso,
        deletedAt: null,
      });

      tx.set(docRef, nextRecord);

      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: 'document.restore',
        targetType: 'document',
        targetId: current.id,
        appId: null,
        appVersion: null,
        metadata: {
          version: nextVersion,
        },
      });

      return nextRecord;
    });

    return this.decryptStoredDocument(verified.orgId, restored);
  }

  async listDocumentVersions(
    actor: VerifiedActor,
    docId: string
  ): Promise<DecryptedDocumentVersion[]> {
    const verified = this.assertActor(actor);
    const snaps = await this.versionsCol(verified.orgId, docId).get();
    const keyCache = new Map<number, Buffer>();
    const versions: DecryptedDocumentVersion[] = [];

    for (const docSnap of snaps.docs) {
      const stored = StoredDocumentVersionSchema.parse(docSnap.data());
      let dataKey = keyCache.get(stored.keyVersion);
      if (!dataKey) {
        dataKey = await this.unwrapOrgKeyVersion(verified.orgId, stored.keyVersion);
        keyCache.set(stored.keyVersion, dataKey);
      }
      const body = decryptBody({
        ciphertextBase64: stored.bodyCiphertext,
        dataKey,
        orgId: verified.orgId,
        documentId: docId,
      });
      versions.push(
        DecryptedDocumentVersionSchema.parse({
          version: stored.version,
          body,
          keyVersion: stored.keyVersion,
          sha256: stored.sha256,
          writtenBy: stored.writtenBy,
          createdAt: stored.createdAt,
        })
      );
    }

    return versions.sort((a, b) => b.version - a.version);
  }

  // ==========================================================================
  // Step 3: Memory (Knowledge Collections, Chunks, Vector Search & Rebuild)
  // ==========================================================================

  async createKnowledgeCollection(
    actor: VerifiedActor,
    params: { id?: string; name: string; rootFolderId: string }
  ): Promise<KnowledgeCollection> {
    const verified = this.assertActor(actor);
    const id = params.id ?? randomUUID();
    const nowIso = new Date().toISOString();

    const record: KnowledgeCollection = KnowledgeCollectionSchema.parse({
      id,
      name: params.name,
      rootFolderId: params.rootFolderId,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await this.db.runTransaction(async (tx) => {
      const folderSnap = await tx.get(
        this.documentsCol(verified.orgId).doc(params.rootFolderId)
      );
      if (!folderSnap.exists) {
        throw new NotFoundError(`Root folder ${params.rootFolderId} does not exist`);
      }
      const folder = StoredDocumentSchema.parse(folderSnap.data());
      if (folder.kind !== 'folder') {
        throw new Error(`Document ${params.rootFolderId} is not a folder`);
      }

      tx.set(this.collectionsCol(verified.orgId).doc(id), record);
      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: 'collection.create',
        targetType: 'collection',
        targetId: id,
        appId: null,
        appVersion: null,
        metadata: {
          name: params.name,
          rootFolderId: params.rootFolderId,
        },
      });
    });

    return record;
  }

  async listKnowledgeCollections(actor: VerifiedActor): Promise<KnowledgeCollection[]> {
    const verified = this.assertActor(actor);
    const snaps = await this.collectionsCol(verified.orgId).get();
    return snaps.docs.map((d) => KnowledgeCollectionSchema.parse(d.data()));
  }

  async replaceDocumentChunks(
    actor: VerifiedActor,
    docId: string,
    chunks: Array<{ ordinal: number; text: string; embedding: number[]; sha256: string }>
  ): Promise<Chunk[]> {
    const verified = this.assertActor(actor);
    const existingForDoc = await this.listChunks(verified, docId);

    const created: Chunk[] = chunks.map((c) =>
      ChunkSchema.parse({
        id: `${docId}__chunk_${c.ordinal}`,
        docId,
        ordinal: c.ordinal,
        text: c.text,
        embedding: c.embedding,
        sha256: c.sha256,
      })
    );

    await this.db.runTransaction(async (tx) => {
      for (const oldChunk of existingForDoc) {
        tx.set(this.chunksCol(verified.orgId).doc(oldChunk.id), {
          __deleted: true,
        });
      }
      for (const chunk of created) {
        tx.set(this.chunksCol(verified.orgId).doc(chunk.id), chunk);
      }
    });

    return created;
  }

  async listChunks(actor: VerifiedActor, docId?: string): Promise<Chunk[]> {
    const verified = this.assertActor(actor);
    const snaps = await this.chunksCol(verified.orgId).get();
    const results: Chunk[] = [];
    for (const d of snaps.docs) {
      const raw = d.data();
      if (raw?.__deleted) continue;
      const parsed = ChunkSchema.safeParse(raw);
      if (!parsed.success) continue;
      if (docId && parsed.data.docId !== docId) continue;
      results.push(parsed.data);
    }
    return results.sort((a, b) =>
      a.docId === b.docId
        ? a.ordinal - b.ordinal
        : a.docId.localeCompare(b.docId)
    );
  }

  async deleteAllDerivedChunks(actor: VerifiedActor): Promise<number> {
    const verified = this.assertActor(actor);
    const snaps = await this.chunksCol(verified.orgId).get();
    let count = 0;
    await this.db.runTransaction(async (tx) => {
      for (const d of snaps.docs) {
        const raw = d.data();
        if (!raw?.__deleted) {
          count++;
          tx.set(this.chunksCol(verified.orgId).doc(d.id), { __deleted: true });
        }
      }
    });
    return count;
  }

  async searchVectorChunks(
    actor: VerifiedActor,
    params: {
      collectionIds: string[];
      queryVector: number[];
      topK?: number;
    }
  ): Promise<
    Array<{
      chunk: Chunk;
      documentName: string;
      score: number;
    }>
  > {
    const verified = this.assertActor(actor);
    const topK = params.topK ?? 5;

    // 1. Load declared collections in caller's organization
    const allCollections = await this.listKnowledgeCollections(verified);
    const selectedRootFolders = new Set(
      allCollections
        .filter((c) => params.collectionIds.includes(c.id))
        .map((c) => c.rootFolderId)
    );
    if (selectedRootFolders.size === 0) {
      return [];
    }

    // 2. Determine live documents inside those knowledge collection folder trees
    const docSnaps = await this.documentsCol(verified.orgId).get();
    const eligibleDocs = new Map<string, StoredDocument>();
    for (const d of docSnaps.docs) {
      const doc = StoredDocumentSchema.parse(d.data());
      if (doc.deletedAt !== null || doc.kind !== 'file') continue;
      const inCollection =
        (doc.parentId !== null && selectedRootFolders.has(doc.parentId)) ||
        doc.ancestors.some((anc) => selectedRootFolders.has(anc));
      if (inCollection) {
        eligibleDocs.set(doc.id, doc);
      }
    }

    if (eligibleDocs.size === 0) {
      return [];
    }

    // 3. Score chunks belonging only to eligible documents in caller's organization
    const chunks = await this.listChunks(verified);
    const scored: Array<{ chunk: Chunk; documentName: string; score: number }> = [];

    for (const chunk of chunks) {
      const doc = eligibleDocs.get(chunk.docId);
      if (!doc) continue;
      const score = cosineSimilarity(params.queryVector, chunk.embedding);
      scored.push({
        chunk,
        documentName: doc.name,
        score,
      });
    }

    return scored
      .sort((a, b) => {
        if (Math.abs(b.score - a.score) > 1e-9) {
          return b.score - a.score;
        }
        return a.chunk.id.localeCompare(b.chunk.id);
      })
      .slice(0, topK);
  }

  // ==========================================================================
  // Step 4, 5, 7: App Builder, Snapshots & Encrypted Markdown Records
  // ==========================================================================

  async saveAppDraft(
    actor: VerifiedActor,
    params: {
      appId?: string;
      expectedVersion?: number;
      definition: AppDefinition;
      workflow?: WorkflowDefinition | null;
    }
  ): Promise<App> {
    const verified = this.assertActor(actor);
    const validatedDef = AppDefinitionSchema.parse(params.definition);
    const validatedWorkflow =
      params.workflow !== undefined && params.workflow !== null
        ? WorkflowDefinitionSchema.parse(params.workflow)
        : null;

    const appId = params.appId ?? randomUUID();
    const nowIso = new Date().toISOString();

    return this.db.runTransaction(async (tx) => {
      const appRef = this.appsCol(verified.orgId).doc(appId);
      const snap = await tx.get(appRef);

      if (!snap.exists) {
        const created: App = AppSchema.parse({
          id: appId,
          draftDefinition: validatedDef,
          draftWorkflow: validatedWorkflow,
          version: 1,
          publishedSnapshotVersion: null,
          status: 'draft',
          updatedAt: nowIso,
        });
        tx.create(appRef, created);
        this.writeAuditInTransaction(tx, verified.orgId, {
          actor: verified.uid,
          action: 'app.create_draft',
          targetType: 'app',
          targetId: appId,
          appId,
          appVersion: 1,
          metadata: { name: validatedDef.name },
        });
        return created;
      }

      const current = AppSchema.parse(snap.data());
      if (
        params.expectedVersion !== undefined &&
        current.version !== params.expectedVersion
      ) {
        throw new VersionConflictError(
          appId,
          params.expectedVersion,
          current.version
        );
      }

      const nextVersion = current.version + 1;
      const updated: App = AppSchema.parse({
        ...current,
        draftDefinition: validatedDef,
        draftWorkflow:
          params.workflow !== undefined ? validatedWorkflow : current.draftWorkflow,
        version: nextVersion,
        updatedAt: nowIso,
      });

      tx.set(appRef, updated);
      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: 'app.update_draft',
        targetType: 'app',
        targetId: appId,
        appId,
        appVersion: nextVersion,
        metadata: { name: validatedDef.name, version: nextVersion },
      });

      return updated;
    });
  }

  async getApp(actor: VerifiedActor, appId: string): Promise<App | null> {
    const verified = this.assertActor(actor);
    const snap = await this.appsCol(verified.orgId).doc(appId).get();
    if (!snap.exists) return null;
    return AppSchema.parse(snap.data());
  }

  async listApps(actor: VerifiedActor): Promise<App[]> {
    const verified = this.assertActor(actor);
    const snaps = await this.appsCol(verified.orgId).get();
    return snaps.docs.map((d) => AppSchema.parse(d.data()));
  }

  async publishApp(
    actor: VerifiedActor,
    params: {
      appId: string;
      expectedVersion: number;
      approvalId: string;
      requestMac: string;
    }
  ): Promise<{ app: App; snapshot: AppSnapshot }> {
    const verified = this.assertActor(actor);

    return this.db.runTransaction(async (tx) => {
      const appRef = this.appsCol(verified.orgId).doc(params.appId);
      const approvalRef = this.approvalsCol(verified.orgId).doc(params.approvalId);

      const [appSnap, approvalSnap] = await Promise.all([
        tx.get(appRef),
        tx.get(approvalRef),
      ]);

      if (!appSnap.exists) {
        throw new NotFoundError(`App ${params.appId} not found`);
      }
      if (!approvalSnap.exists) {
        throw new ApprovalVerificationError(`Approval ${params.approvalId} not found`);
      }

      const currentApp = AppSchema.parse(appSnap.data());
      if (currentApp.version !== params.expectedVersion) {
        throw new VersionConflictError(
          params.appId,
          params.expectedVersion,
          currentApp.version
        );
      }

      const storedApproval = ApprovalSchema.parse(approvalSnap.data());
      verifyApprovalForExecution({
        secret: this.approvalSecret,
        storedApproval,
        orgId: verified.orgId,
        actorUid: verified.uid,
        expectedAction: 'publish_app',
        providedMac: params.requestMac,
        actualRequestPayload: {
          appId: params.appId,
          expectedVersion: params.expectedVersion,
        },
      });

      tx.update(approvalRef, { used: true });

      const nowIso = new Date().toISOString();
      const snapshotVersion = (currentApp.publishedSnapshotVersion ?? 0) + 1;
      const nextAppVersion = currentApp.version + 1;

      const snapshot: AppSnapshot = AppSnapshotSchema.parse({
        version: snapshotVersion,
        definition: currentApp.draftDefinition,
        workflow: currentApp.draftWorkflow,
        publishedBy: verified.uid,
        publishedAt: nowIso,
      });

      const updatedApp: App = AppSchema.parse({
        ...currentApp,
        version: nextAppVersion,
        publishedSnapshotVersion: snapshotVersion,
        status: 'published',
        updatedAt: nowIso,
      });

      tx.create(
        this.snapshotsCol(verified.orgId, params.appId).doc(String(snapshotVersion)),
        snapshot
      );
      tx.set(appRef, updatedApp);

      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: 'app.publish',
        targetType: 'app',
        targetId: params.appId,
        appId: params.appId,
        appVersion: snapshotVersion,
        metadata: {
          snapshotVersion,
          approvalId: params.approvalId,
        },
      });

      return { app: updatedApp, snapshot };
    });
  }

  async getAppSnapshot(
    actor: VerifiedActor,
    appId: string,
    snapshotVersion: number
  ): Promise<AppSnapshot | null> {
    const verified = this.assertActor(actor);
    const snap = await this.snapshotsCol(verified.orgId, appId)
      .doc(String(snapshotVersion))
      .get();
    if (!snap.exists) return null;
    return AppSnapshotSchema.parse(snap.data());
  }

  private recordAadId(appId: string, recId: string): string {
    return `app:${appId}:rec:${recId}`;
  }

  private async decryptStoredAppRecord(
    orgId: string,
    stored: StoredAppRecord
  ): Promise<DecryptedAppRecord> {
    const dataKey = await this.unwrapOrgKeyVersion(orgId, stored.keyVersion);
    const body = decryptBody({
      ciphertextBase64: stored.bodyCiphertext,
      dataKey,
      orgId,
      documentId: this.recordAadId(stored.appId, stored.id),
    });
    const parsed = parseMarkdownToRecord(body);
    return DecryptedAppRecordSchema.parse({
      id: stored.id,
      appId: stored.appId,
      body,
      fields: parsed.fields,
      notesMarkdown: parsed.notesMarkdown,
      keyVersion: stored.keyVersion,
      sha256: stored.sha256,
      version: stored.version,
      updatedAt: stored.updatedAt,
      deletedAt: stored.deletedAt,
    });
  }

  async createAppRecord(
    actor: VerifiedActor,
    params: {
      appId: string;
      recId?: string;
      fields: Record<string, string | number | null>;
      notesMarkdown?: string;
    }
  ): Promise<DecryptedAppRecord> {
    const verified = this.assertActor(actor);
    const recId = params.recId ?? randomUUID();
    const { version: keyVersion, plainKey } = await this.getOrProvisionActiveOrgKey(
      verified.orgId
    );

    const markdownBody = serializeRecordToMarkdown({
      fields: params.fields,
      notesMarkdown: params.notesMarkdown,
    });
    const bodyCiphertext = encryptBody({
      plainText: markdownBody,
      dataKey: plainKey,
      orgId: verified.orgId,
      documentId: this.recordAadId(params.appId, recId),
    });
    const sha256 = sha256Hex(markdownBody);
    const nowIso = new Date().toISOString();

    const stored = await this.db.runTransaction(async (tx) => {
      const appSnap = await tx.get(this.appsCol(verified.orgId).doc(params.appId));
      const appVersion = appSnap.exists
        ? ((appSnap.data()?.publishedSnapshotVersion as number | null) ??
          (appSnap.data()?.version as number) ??
          1)
        : 1;

      const recRef = this.recordsCol(verified.orgId, params.appId).doc(recId);
      const record: StoredAppRecord = StoredAppRecordSchema.parse({
        id: recId,
        appId: params.appId,
        bodyCiphertext,
        keyVersion,
        sha256,
        version: 1,
        updatedAt: nowIso,
        deletedAt: null,
      });

      tx.create(recRef, record);
      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: 'record.create',
        targetType: 'record',
        targetId: recId,
        appId: params.appId,
        appVersion,
        metadata: { version: 1, sha256 },
      });

      return record;
    });

    return DecryptedAppRecordSchema.parse({
      id: stored.id,
      appId: stored.appId,
      body: markdownBody,
      fields: params.fields,
      notesMarkdown: params.notesMarkdown ?? '',
      keyVersion: stored.keyVersion,
      sha256: stored.sha256,
      version: stored.version,
      updatedAt: stored.updatedAt,
      deletedAt: stored.deletedAt,
    });
  }

  async updateAppRecord(
    actor: VerifiedActor,
    params: {
      appId: string;
      recId: string;
      expectedVersion: number;
      fields: Record<string, string | number | null>;
      notesMarkdown?: string;
    }
  ): Promise<DecryptedAppRecord> {
    const verified = this.assertActor(actor);
    const { version: keyVersion, plainKey } = await this.getOrProvisionActiveOrgKey(
      verified.orgId
    );

    const markdownBody = serializeRecordToMarkdown({
      fields: params.fields,
      notesMarkdown: params.notesMarkdown,
    });
    const bodyCiphertext = encryptBody({
      plainText: markdownBody,
      dataKey: plainKey,
      orgId: verified.orgId,
      documentId: this.recordAadId(params.appId, params.recId),
    });
    const sha256 = sha256Hex(markdownBody);
    const nowIso = new Date().toISOString();

    const stored = await this.db.runTransaction(async (tx) => {
      const recRef = this.recordsCol(verified.orgId, params.appId).doc(params.recId);
      const snap = await tx.get(recRef);
      if (!snap.exists) {
        throw new NotFoundError(`Record ${params.recId} not found`);
      }
      const current = StoredAppRecordSchema.parse(snap.data());
      if (current.version !== params.expectedVersion) {
        throw new VersionConflictError(
          params.recId,
          params.expectedVersion,
          current.version
        );
      }

      const nextVersion = current.version + 1;
      const updated: StoredAppRecord = StoredAppRecordSchema.parse({
        ...current,
        bodyCiphertext,
        keyVersion,
        sha256,
        version: nextVersion,
        updatedAt: nowIso,
      });

      tx.set(recRef, updated);
      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: 'record.update',
        targetType: 'record',
        targetId: params.recId,
        appId: params.appId,
        appVersion: null,
        metadata: { previousVersion: current.version, version: nextVersion },
      });

      return updated;
    });

    return DecryptedAppRecordSchema.parse({
      id: stored.id,
      appId: stored.appId,
      body: markdownBody,
      fields: params.fields,
      notesMarkdown: params.notesMarkdown ?? '',
      keyVersion: stored.keyVersion,
      sha256: stored.sha256,
      version: stored.version,
      updatedAt: stored.updatedAt,
      deletedAt: stored.deletedAt,
    });
  }

  async transitionAppRecordStatus(
    actor: VerifiedActor,
    params: {
      appId: string;
      recId: string;
      expectedVersion: number;
      statusField: string;
      toStatus: string;
      approvalId?: string;
      requestMac?: string;
    }
  ): Promise<DecryptedAppRecord> {
    const verified = this.assertActor(actor);
    const { version: keyVersion, plainKey } = await this.getOrProvisionActiveOrgKey(
      verified.orgId
    );

    return this.db.runTransaction(async (tx) => {
      const appRef = this.appsCol(verified.orgId).doc(params.appId);
      const recRef = this.recordsCol(verified.orgId, params.appId).doc(params.recId);

      const [appSnap, recSnap] = await Promise.all([
        tx.get(appRef),
        tx.get(recRef),
      ]);

      if (!appSnap.exists) {
        throw new NotFoundError(`App ${params.appId} not found`);
      }
      if (!recSnap.exists) {
        throw new NotFoundError(`Record ${params.recId} not found`);
      }

      const app = AppSchema.parse(appSnap.data());
      const currentStored = StoredAppRecordSchema.parse(recSnap.data());
      if (currentStored.version !== params.expectedVersion) {
        throw new VersionConflictError(
          params.recId,
          params.expectedVersion,
          currentStored.version
        );
      }

      const currentDecrypted = await this.decryptStoredAppRecord(
        verified.orgId,
        currentStored
      );
      const fromStatus = String(currentDecrypted.fields[params.statusField] ?? '');

      const rules = app.draftDefinition.statusTransitions;
      if (rules.length > 0) {
        const matchingRule = rules.find(
          (r) => r.fromStatus === fromStatus && r.toStatus === params.toStatus
        );
        if (!matchingRule) {
          throw new Error(
            `Status transition from "${fromStatus}" to "${params.toStatus}" is not permitted`
          );
        }
        if (!matchingRule.allowedRoles.includes(verified.role)) {
          throw new Error(
            `Role "${verified.role}" is not allowed to transition from "${fromStatus}" to "${params.toStatus}"`
          );
        }
        if (
          matchingRule.approverUids.length > 0 &&
          !matchingRule.approverUids.includes(verified.uid)
        ) {
          throw new Error(
            `Actor "${verified.uid}" is not a named approver for transition "${fromStatus}" -> "${params.toStatus}"`
          );
        }
      }

      if (params.approvalId && params.requestMac) {
        const approvalRef = this.approvalsCol(verified.orgId).doc(params.approvalId);
        const approvalSnap = await tx.get(approvalRef);
        if (!approvalSnap.exists) {
          throw new ApprovalVerificationError(`Approval ${params.approvalId} not found`);
        }
        const storedApproval = ApprovalSchema.parse(approvalSnap.data());
        verifyApprovalForExecution({
          secret: this.approvalSecret,
          storedApproval,
          orgId: verified.orgId,
          actorUid: verified.uid,
          expectedAction: 'transition_record_status',
          providedMac: params.requestMac,
          actualRequestPayload: {
            appId: params.appId,
            recId: params.recId,
            expectedVersion: params.expectedVersion,
            toStatus: params.toStatus,
          },
        });
        tx.update(approvalRef, { used: true });
      }

      const nextFields = {
        ...currentDecrypted.fields,
        [params.statusField]: params.toStatus,
      };
      const nextMarkdown = serializeRecordToMarkdown({
        fields: nextFields,
        notesMarkdown: currentDecrypted.notesMarkdown,
      });
      const bodyCiphertext = encryptBody({
        plainText: nextMarkdown,
        dataKey: plainKey,
        orgId: verified.orgId,
        documentId: this.recordAadId(params.appId, params.recId),
      });
      const sha256 = sha256Hex(nextMarkdown);
      const nextVersion = currentStored.version + 1;
      const nowIso = new Date().toISOString();

      const updatedStored: StoredAppRecord = StoredAppRecordSchema.parse({
        ...currentStored,
        bodyCiphertext,
        keyVersion,
        sha256,
        version: nextVersion,
        updatedAt: nowIso,
      });

      tx.set(recRef, updatedStored);
      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: 'record.transition_status',
        targetType: 'record',
        targetId: params.recId,
        appId: params.appId,
        appVersion: app.publishedSnapshotVersion ?? app.version,
        metadata: {
          fromStatus,
          toStatus: params.toStatus,
          version: nextVersion,
        },
      });

      return DecryptedAppRecordSchema.parse({
        id: updatedStored.id,
        appId: updatedStored.appId,
        body: nextMarkdown,
        fields: nextFields,
        notesMarkdown: currentDecrypted.notesMarkdown,
        keyVersion: updatedStored.keyVersion,
        sha256: updatedStored.sha256,
        version: updatedStored.version,
        updatedAt: updatedStored.updatedAt,
        deletedAt: updatedStored.deletedAt,
      });
    });
  }

  async archiveAppRecord(
    actor: VerifiedActor,
    params: {
      appId: string;
      recId: string;
      expectedVersion: number;
      approvalId: string;
      requestMac: string;
    }
  ): Promise<DecryptedAppRecord> {
    const verified = this.assertActor(actor);

    const archived = await this.db.runTransaction(async (tx) => {
      const recRef = this.recordsCol(verified.orgId, params.appId).doc(params.recId);
      const approvalRef = this.approvalsCol(verified.orgId).doc(params.approvalId);

      const [recSnap, approvalSnap] = await Promise.all([
        tx.get(recRef),
        tx.get(approvalRef),
      ]);

      if (!recSnap.exists) {
        throw new NotFoundError(`Record ${params.recId} not found`);
      }
      if (!approvalSnap.exists) {
        throw new ApprovalVerificationError(`Approval ${params.approvalId} not found`);
      }

      const current = StoredAppRecordSchema.parse(recSnap.data());
      if (current.version !== params.expectedVersion) {
        throw new VersionConflictError(
          params.recId,
          params.expectedVersion,
          current.version
        );
      }

      const storedApproval = ApprovalSchema.parse(approvalSnap.data());
      verifyApprovalForExecution({
        secret: this.approvalSecret,
        storedApproval,
        orgId: verified.orgId,
        actorUid: verified.uid,
        expectedAction: 'archive_record',
        providedMac: params.requestMac,
        actualRequestPayload: {
          appId: params.appId,
          recId: params.recId,
          expectedVersion: params.expectedVersion,
        },
      });

      tx.update(approvalRef, { used: true });

      const nowIso = new Date().toISOString();
      const nextVersion = current.version + 1;
      const updated: StoredAppRecord = StoredAppRecordSchema.parse({
        ...current,
        version: nextVersion,
        updatedAt: nowIso,
        deletedAt: nowIso,
      });

      tx.set(recRef, updated);
      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: 'record.archive',
        targetType: 'record',
        targetId: params.recId,
        appId: params.appId,
        appVersion: null,
        metadata: { approvalId: params.approvalId, version: nextVersion },
      });

      return updated;
    });

    return this.decryptStoredAppRecord(verified.orgId, archived);
  }

  async listAppRecords(
    actor: VerifiedActor,
    appId: string,
    includeDeleted = false
  ): Promise<DecryptedAppRecord[]> {
    const verified = this.assertActor(actor);
    const snaps = await this.recordsCol(verified.orgId, appId).get();
    const results: DecryptedAppRecord[] = [];
    for (const d of snaps.docs) {
      const stored = StoredAppRecordSchema.parse(d.data());
      if (!includeDeleted && stored.deletedAt !== null) continue;
      results.push(await this.decryptStoredAppRecord(verified.orgId, stored));
    }
    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // ==========================================================================
  // Step 6: Encrypted Automation Queue & Transactional Job Worker
  // ==========================================================================

  private queueAadId(itemId: string): string {
    return `queue:${itemId}`;
  }

  async enqueueAutomation(
    actor: VerifiedActor,
    params: {
      id?: string;
      appId: string;
      snapshotVersion: number;
      triggerType: 'webhook' | 'schedule';
      payload: Record<string, unknown>;
    }
  ): Promise<StoredQueueItem> {
    const verified = this.assertActor(actor);
    const itemId = params.id ?? randomUUID();
    const { version: keyVersion, plainKey } = await this.getOrProvisionActiveOrgKey(
      verified.orgId
    );

    const payloadCiphertext = encryptBody({
      plainText: JSON.stringify(params.payload),
      dataKey: plainKey,
      orgId: verified.orgId,
      documentId: this.queueAadId(itemId),
    });

    const nowIso = new Date().toISOString();
    const item: StoredQueueItem = StoredQueueItemSchema.parse({
      id: itemId,
      appId: params.appId,
      snapshotVersion: params.snapshotVersion,
      triggerType: params.triggerType,
      payloadCiphertext,
      keyVersion,
      status: 'pending',
      attempts: 0,
      claimedBy: null,
      leaseExpiresAt: null,
      outputDocId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await this.db.runTransaction(async (tx) => {
      tx.create(this.queueCol(verified.orgId).doc(itemId), item);
      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: `queue.enqueue.${params.triggerType}`,
        targetType: 'queue',
        targetId: itemId,
        appId: params.appId,
        appVersion: params.snapshotVersion,
        metadata: { triggerType: params.triggerType },
      });
    });

    return item;
  }

  async claimNextAutomationItem(
    actor: VerifiedActor,
    params: {
      workerId: string;
      leaseDurationMs?: number;
      now?: Date;
    }
  ): Promise<{
    item: StoredQueueItem;
    decryptedPayload: Record<string, unknown>;
    snapshot: AppSnapshot;
  } | null> {
    const verified = this.assertActor(actor);
    const now = params.now ?? new Date();
    const leaseDurationMs = params.leaseDurationMs ?? 30_000;
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();

    const claimed = await this.db.runTransaction(async (tx) => {
      const snaps = await this.queueCol(verified.orgId).get();
      const candidates = snaps.docs
        .map((d) => StoredQueueItemSchema.parse(d.data()))
        .filter((it) => {
          if (it.status === 'pending') return true;
          if (
            it.status === 'claimed' &&
            it.attempts < 2 &&
            it.leaseExpiresAt !== null &&
            Date.parse(it.leaseExpiresAt) <= now.getTime()
          ) {
            return true;
          }
          return false;
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      const target = candidates[0];
      if (!target) {
        return null;
      }

      const itemRef = this.queueCol(verified.orgId).doc(target.id);
      const freshSnap = await tx.get(itemRef);
      if (!freshSnap.exists) return null;
      const fresh = StoredQueueItemSchema.parse(freshSnap.data());

      const isClaimable =
        fresh.status === 'pending' ||
        (fresh.status === 'claimed' &&
          fresh.attempts < 2 &&
          fresh.leaseExpiresAt !== null &&
          Date.parse(fresh.leaseExpiresAt) <= now.getTime());

      if (!isClaimable) {
        return null;
      }

      const snapRef = this.snapshotsCol(verified.orgId, fresh.appId).doc(
        String(fresh.snapshotVersion)
      );
      const snapshotDoc = await tx.get(snapRef);
      if (!snapshotDoc.exists) {
        throw new NotFoundError(
          `Snapshot ${fresh.snapshotVersion} for app ${fresh.appId} not found`
        );
      }
      const snapshot = AppSnapshotSchema.parse(snapshotDoc.data());

      const updatedItem: StoredQueueItem = StoredQueueItemSchema.parse({
        ...fresh,
        status: 'claimed',
        attempts: fresh.attempts + 1,
        claimedBy: params.workerId,
        leaseExpiresAt,
        updatedAt: now.toISOString(),
      });

      tx.set(itemRef, updatedItem);
      return { updatedItem, snapshot };
    });

    if (!claimed) {
      return null;
    }

    const dataKey = await this.unwrapOrgKeyVersion(
      verified.orgId,
      claimed.updatedItem.keyVersion
    );
    const decryptedJson = decryptBody({
      ciphertextBase64: claimed.updatedItem.payloadCiphertext,
      dataKey,
      orgId: verified.orgId,
      documentId: this.queueAadId(claimed.updatedItem.id),
    });

    return {
      item: claimed.updatedItem,
      decryptedPayload: JSON.parse(decryptedJson) as Record<string, unknown>,
      snapshot: claimed.snapshot,
    };
  }

  async completeAutomationItem(
    actor: VerifiedActor,
    params: {
      itemId: string;
      workerId: string;
      outputFolderId: string;
      outputFileName: string;
      outputMarkdown: string;
    }
  ): Promise<{ item: StoredQueueItem; outputDocument: DecryptedDocument }> {
    const verified = this.assertActor(actor);
    const { version: keyVersion, plainKey } = await this.getOrProvisionActiveOrgKey(
      verified.orgId
    );

    // Deterministic output document ID ensures idempotency across retries
    const outputDocId = `auto-out-${params.itemId}`;
    const bodyCiphertext = encryptBody({
      plainText: params.outputMarkdown,
      dataKey: plainKey,
      orgId: verified.orgId,
      documentId: outputDocId,
    });
    const sha256 = sha256Hex(params.outputMarkdown);
    const sizeBytes = Buffer.byteLength(params.outputMarkdown, 'utf8');
    const nowIso = new Date().toISOString();

    const result = await this.db.runTransaction(async (tx) => {
      const itemRef = this.queueCol(verified.orgId).doc(params.itemId);
      const itemSnap = await tx.get(itemRef);
      if (!itemSnap.exists) {
        throw new NotFoundError(`Queue item ${params.itemId} not found`);
      }

      const currentItem = StoredQueueItemSchema.parse(itemSnap.data());
      if (currentItem.status === 'completed') {
        throw new Error(`Queue item ${params.itemId} is already completed`);
      }
      if (currentItem.claimedBy !== params.workerId) {
        throw new Error(
          `Queue item ${params.itemId} is claimed by ${currentItem.claimedBy}, not ${params.workerId}`
        );
      }

      const folderRef = this.documentsCol(verified.orgId).doc(params.outputFolderId);
      const folderSnap = await tx.get(folderRef);
      let ancestors: string[] = [];
      if (folderSnap.exists) {
        const folderDoc = StoredDocumentSchema.parse(folderSnap.data());
        ancestors = [...folderDoc.ancestors, folderDoc.id];
      }

      const outputDocRef = this.documentsCol(verified.orgId).doc(outputDocId);
      const storedDoc: StoredDocument = StoredDocumentSchema.parse({
        id: outputDocId,
        kind: 'file',
        name: params.outputFileName,
        parentId: folderSnap.exists ? params.outputFolderId : null,
        ancestors,
        bodyCiphertext,
        keyVersion,
        sha256,
        sizeBytes,
        language: 'en',
        version: 1,
        updatedAt: nowIso,
        deletedAt: null,
      });

      const versionRecord: StoredDocumentVersion = StoredDocumentVersionSchema.parse({
        version: 1,
        bodyCiphertext,
        keyVersion,
        sha256,
        writtenBy: verified.uid,
        createdAt: nowIso,
      });

      const completedItem: StoredQueueItem = StoredQueueItemSchema.parse({
        ...currentItem,
        status: 'completed',
        outputDocId,
        leaseExpiresAt: null,
        updatedAt: nowIso,
      });

      tx.set(outputDocRef, storedDoc);
      tx.set(this.versionsCol(verified.orgId, outputDocId).doc('1'), versionRecord);
      tx.set(itemRef, completedItem);

      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: 'queue.complete',
        targetType: 'queue',
        targetId: params.itemId,
        appId: currentItem.appId,
        appVersion: currentItem.snapshotVersion,
        metadata: {
          outputDocId,
          attempts: currentItem.attempts,
        },
      });

      return { completedItem, storedDoc };
    });

    const { bodyCiphertext: _omitted, ...restDoc } = result.storedDoc;
    return {
      item: result.completedItem,
      outputDocument: DecryptedDocumentSchema.parse({
        ...restDoc,
        body: params.outputMarkdown,
      }),
    };
  }

  async listQueueItems(actor: VerifiedActor): Promise<StoredQueueItem[]> {
    const verified = this.assertActor(actor);
    const snaps = await this.queueCol(verified.orgId).get();
    return snaps.docs.map((d) => StoredQueueItemSchema.parse(d.data()));
  }

  // ==========================================================================
  // Runs, Approvals & Audit Querying
  // ==========================================================================

  async recordRun(
    actor: VerifiedActor,
    runInput: Omit<Run, 'id' | 'createdAt'>
  ): Promise<Run> {
    const verified = this.assertActor(actor);
    const id = randomUUID();
    const nowIso = new Date().toISOString();
    const run: Run = RunSchema.parse({
      ...runInput,
      id,
      createdAt: nowIso,
    });

    await this.db.runTransaction(async (tx) => {
      tx.create(this.runsCol(verified.orgId).doc(id), run);
      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: `agent.run.${run.status}`,
        targetType: 'agent_run',
        targetId: id,
        appId: null,
        appVersion: null,
        metadata: {
          model: run.model,
          tokens: run.tokens,
          cost: run.cost,
          latency: run.latency,
        },
      });
    });

    return run;
  }

  async issueApproval(
    actor: VerifiedActor,
    params: {
      action: ConsequentialActionType;
      canonicalPayload: Record<string, unknown>;
      ttlSeconds?: number;
    }
  ): Promise<Approval> {
    const verified = this.assertActor(actor);
    const ttl = params.ttlSeconds ?? 300;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000);
    const id = randomUUID();

    const requestMac = computeApprovalMac({
      secret: this.approvalSecret,
      orgId: verified.orgId,
      actorUid: verified.uid,
      action: params.action,
      canonicalPayload: params.canonicalPayload,
    });

    const approval: Approval = ApprovalSchema.parse({
      id,
      requestMac,
      actor: verified.uid,
      action: params.action,
      expiresAt: expiresAt.toISOString(),
      used: false,
      createdAt: now.toISOString(),
    });

    await this.db.runTransaction(async (tx) => {
      const ref = this.approvalsCol(verified.orgId).doc(id);
      tx.create(ref, approval);
      this.writeAuditInTransaction(tx, verified.orgId, {
        actor: verified.uid,
        action: `approval.issue.${params.action}`,
        targetType: 'approval',
        targetId: id,
        appId: null,
        appVersion: null,
        metadata: {
          action: params.action,
          expiresAt: approval.expiresAt,
        },
      });
    });

    return approval;
  }

  async listAuditEvents(
    actor: VerifiedActor,
    options?: { limit?: number; targetId?: string; appId?: string }
  ): Promise<AuditEvent[]> {
    const verified = this.assertActor(actor);
    const snaps = await this.auditCol(verified.orgId).get();
    const events = snaps.docs
      .map((d) => AuditEventSchema.parse(d.data()))
      .filter((ev) => {
        if (options?.targetId && ev.targetId !== options.targetId) {
          return false;
        }
        if (options?.appId && ev.appId !== options.appId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return options?.limit ? events.slice(0, options.limit) : events;
  }
}

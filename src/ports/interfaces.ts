import type {
  App,
  AppDefinition,
  Approval,
  AppSnapshot,
  ArchiveDocumentInput,
  AuditEvent,
  Chunk,
  ConsequentialActionType,
  CreateDocumentInput,
  DecryptedAppRecord,
  DecryptedDocument,
  DecryptedDocumentVersion,
  KnowledgeCollection,
  Member,
  MoveDocumentInput,
  Organization,
  RestoreDocumentInput,
  Role,
  Run,
  StoredDocument,
  StoredQueueItem,
  UpdateDocumentInput,
  VerifiedActor,
  WorkflowDefinition,
} from '../domain/schemas';

/**
 * Principle 8: Everything replaceable sits behind an interface.
 */

export interface KeyProvider {
  readonly kmsKeyName: string;
  wrapKey(plainKey: Buffer, aad: string): Promise<string>;
  unwrapKey(wrappedKeyBase64: string, aad: string): Promise<Buffer>;
}

export interface IdentityProvider {
  verifyIdToken(token: string): Promise<VerifiedActor>;
  setTenantClaims(uid: string, claims: { orgId: string; role: Role }): Promise<void>;
}

export interface DocumentStore {
  // Organization & Membership
  createOrganization(params: {
    orgId: string;
    name: string;
    ownerUid: string;
    ownerEmail?: string;
    ownerDisplayName?: string;
  }): Promise<Organization>;

  getOrganization(actor: VerifiedActor): Promise<Organization | null>;
  listMembers(actor: VerifiedActor): Promise<Member[]>;

  // Step 1: Workspace Documents (Markdown files & folders)
  createDocument(
    actor: VerifiedActor,
    input: CreateDocumentInput
  ): Promise<DecryptedDocument>;

  getDocument(
    actor: VerifiedActor,
    docId: string
  ): Promise<DecryptedDocument | null>;

  getRawStoredDocument(
    actor: VerifiedActor,
    docId: string
  ): Promise<StoredDocument | null>;

  listDocuments(
    actor: VerifiedActor,
    options?: {
      parentId?: string | null;
      includeDeleted?: boolean;
    }
  ): Promise<DecryptedDocument[]>;

  updateDocument(
    actor: VerifiedActor,
    input: UpdateDocumentInput
  ): Promise<DecryptedDocument>;

  moveDocument(
    actor: VerifiedActor,
    input: MoveDocumentInput
  ): Promise<DecryptedDocument>;

  archiveDocument(
    actor: VerifiedActor,
    input: ArchiveDocumentInput
  ): Promise<DecryptedDocument>;

  restoreDocument(
    actor: VerifiedActor,
    input: RestoreDocumentInput
  ): Promise<DecryptedDocument>;

  listDocumentVersions(
    actor: VerifiedActor,
    docId: string
  ): Promise<DecryptedDocumentVersion[]>;

  // Step 3: Memory (Knowledge Collections, Chunks, Vector Search & Rebuild)
  createKnowledgeCollection(
    actor: VerifiedActor,
    params: { id?: string; name: string; rootFolderId: string }
  ): Promise<KnowledgeCollection>;

  listKnowledgeCollections(actor: VerifiedActor): Promise<KnowledgeCollection[]>;

  replaceDocumentChunks(
    actor: VerifiedActor,
    docId: string,
    chunks: Array<{ ordinal: number; text: string; embedding: number[]; sha256: string }>
  ): Promise<Chunk[]>;

  listChunks(actor: VerifiedActor, docId?: string): Promise<Chunk[]>;

  deleteAllDerivedChunks(actor: VerifiedActor): Promise<number>;

  searchVectorChunks(
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
  >;

  // Step 4, 5, 7: App Builder, Snapshots & Encrypted Markdown Records
  saveAppDraft(
    actor: VerifiedActor,
    params: {
      appId?: string;
      expectedVersion?: number;
      definition: AppDefinition;
      workflow?: WorkflowDefinition | null;
    }
  ): Promise<App>;

  getApp(actor: VerifiedActor, appId: string): Promise<App | null>;
  listApps(actor: VerifiedActor): Promise<App[]>;

  publishApp(
    actor: VerifiedActor,
    params: {
      appId: string;
      expectedVersion: number;
      approvalId: string;
      requestMac: string;
    }
  ): Promise<{ app: App; snapshot: AppSnapshot }>;

  getAppSnapshot(
    actor: VerifiedActor,
    appId: string,
    snapshotVersion: number
  ): Promise<AppSnapshot | null>;

  createAppRecord(
    actor: VerifiedActor,
    params: {
      appId: string;
      recId?: string;
      fields: Record<string, string | number | null>;
      notesMarkdown?: string;
    }
  ): Promise<DecryptedAppRecord>;

  updateAppRecord(
    actor: VerifiedActor,
    params: {
      appId: string;
      recId: string;
      expectedVersion: number;
      fields: Record<string, string | number | null>;
      notesMarkdown?: string;
    }
  ): Promise<DecryptedAppRecord>;

  transitionAppRecordStatus(
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
  ): Promise<DecryptedAppRecord>;

  archiveAppRecord(
    actor: VerifiedActor,
    params: {
      appId: string;
      recId: string;
      expectedVersion: number;
      approvalId: string;
      requestMac: string;
    }
  ): Promise<DecryptedAppRecord>;

  listAppRecords(
    actor: VerifiedActor,
    appId: string,
    includeDeleted?: boolean
  ): Promise<DecryptedAppRecord[]>;

  // Step 6: Encrypted Automation Queue
  enqueueAutomation(
    actor: VerifiedActor,
    params: {
      id?: string;
      appId: string;
      snapshotVersion: number;
      triggerType: 'webhook' | 'schedule';
      payload: Record<string, unknown>;
    }
  ): Promise<StoredQueueItem>;

  claimNextAutomationItem(
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
  } | null>;

  completeAutomationItem(
    actor: VerifiedActor,
    params: {
      itemId: string;
      workerId: string;
      outputFolderId: string;
      outputFileName: string;
      outputMarkdown: string;
    }
  ): Promise<{ item: StoredQueueItem; outputDocument: DecryptedDocument }>;

  listQueueItems(actor: VerifiedActor): Promise<StoredQueueItem[]>;

  // Runs, Approvals & Audit
  recordRun(
    actor: VerifiedActor,
    run: Omit<Run, 'id' | 'createdAt'>
  ): Promise<Run>;

  issueApproval(
    actor: VerifiedActor,
    params: {
      action: ConsequentialActionType;
      canonicalPayload: Record<string, unknown>;
      ttlSeconds?: number;
    }
  ): Promise<Approval>;

  listAuditEvents(
    actor: VerifiedActor,
    options?: { limit?: number; targetId?: string; appId?: string }
  ): Promise<AuditEvent[]>;
}

export interface ObjectStore {
  putObject(params: {
    orgId: string;
    path: string;
    data: Buffer;
    contentType: string;
  }): Promise<{ uri: string; sizeBytes: number }>;

  getObject(params: { orgId: string; path: string }): Promise<Buffer>;
  deleteObject(params: { orgId: string; path: string }): Promise<void>;
}

export interface Transcriber {
  transcribeAudio(params: {
    audioBytes: Buffer;
    mimeType: string;
    languageHint?: string;
  }): Promise<{ markdown: string; model: string; tokensUsed: number }>;
}

export interface Embedder {
  embedText(text: string): Promise<{ vector: number[]; model: string }>;
  embedBatch(texts: string[]): Promise<{ vectors: number[][]; model: string }>;
}

export interface ModelProvider {
  generateGroundedAnswer(params: {
    question: string;
    chunks: Array<{ docId: string; documentName: string; ordinal: number; text: string }>;
  }): Promise<{
    answerMarkdown: string;
    notFound: boolean;
    citations: Array<{ docId: string; paragraphOrdinal: number }>;
    model: string;
    tokensUsed: number;
  }>;
}

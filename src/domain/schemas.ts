import { z } from 'zod';

// ============================================================================
// Identity & Organization Schemas
// ============================================================================

export const RoleSchema = z.enum(['owner', 'admin', 'member']);
export type Role = z.infer<typeof RoleSchema>;

export const VerifiedActorSchema = z
  .object({
    uid: z.string().min(1),
    orgId: z.string().min(1),
    role: RoleSchema,
    email: z.string().email().optional(),
  })
  .strict();
export type VerifiedActor = z.infer<typeof VerifiedActorSchema>;

export const OrganizationSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(120),
    createdBy: z.string().min(1),
    activeKeyVersion: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type Organization = z.infer<typeof OrganizationSchema>;

export const MemberSchema = z
  .object({
    uid: z.string().min(1),
    role: RoleSchema,
    email: z.string().email().optional(),
    displayName: z.string().max(120).optional(),
    joinedAt: z.string().datetime(),
  })
  .strict();
export type Member = z.infer<typeof MemberSchema>;

// ============================================================================
// Per-Organization Envelope Key Schema (organizations/{orgId}/keys/{version})
// ============================================================================

export const OrgKeySchema = z
  .object({
    version: z.number().int().positive(),
    wrappedKey: z.string().min(1), // Base64-encoded KMS ciphertext
    kmsKeyName: z.string().min(1),
    createdAt: z.string().datetime(),
    retiredAt: z.string().datetime().nullable(),
  })
  .strict();
export type OrgKey = z.infer<typeof OrgKeySchema>;

// ============================================================================
// Workspace Document & Version Schemas (organizations/{orgId}/documents/{docId})
// ============================================================================

export const DocumentKindSchema = z.enum(['file', 'folder']);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;

export const StoredDocumentSchema = z
  .object({
    id: z.string().min(1),
    kind: DocumentKindSchema,
    name: z.string().min(1).max(255),
    parentId: z.string().min(1).nullable(),
    ancestors: z.array(z.string().min(1)).max(32),
    bodyCiphertext: z.string(), // Base64 AES-256-GCM envelope (empty string for folders)
    keyVersion: z.number().int().positive(),
    sha256: z.string().length(64),
    sizeBytes: z.number().int().nonnegative(),
    language: z.string().min(2).max(16),
    version: z.number().int().positive(),
    updatedAt: z.string().datetime(),
    deletedAt: z.string().datetime().nullable(),
  })
  .strict();
export type StoredDocument = z.infer<typeof StoredDocumentSchema>;

export const DecryptedDocumentSchema = z
  .object({
    id: z.string().min(1),
    kind: DocumentKindSchema,
    name: z.string().min(1).max(255),
    parentId: z.string().min(1).nullable(),
    ancestors: z.array(z.string().min(1)).max(32),
    body: z.string(), // Plain Markdown (empty string for folders)
    keyVersion: z.number().int().positive(),
    sha256: z.string().length(64),
    sizeBytes: z.number().int().nonnegative(),
    language: z.string().min(2).max(16),
    version: z.number().int().positive(),
    updatedAt: z.string().datetime(),
    deletedAt: z.string().datetime().nullable(),
  })
  .strict();
export type DecryptedDocument = z.infer<typeof DecryptedDocumentSchema>;

export const StoredDocumentVersionSchema = z
  .object({
    version: z.number().int().positive(),
    bodyCiphertext: z.string().min(1),
    keyVersion: z.number().int().positive(),
    sha256: z.string().length(64),
    writtenBy: z.string().min(1),
    createdAt: z.string().datetime(),
  })
  .strict();
export type StoredDocumentVersion = z.infer<typeof StoredDocumentVersionSchema>;

export const DecryptedDocumentVersionSchema = z
  .object({
    version: z.number().int().positive(),
    body: z.string(),
    keyVersion: z.number().int().positive(),
    sha256: z.string().length(64),
    writtenBy: z.string().min(1),
    createdAt: z.string().datetime(),
  })
  .strict();
export type DecryptedDocumentVersion = z.infer<typeof DecryptedDocumentVersionSchema>;

// ============================================================================
// Step 1 Mutation Input Schemas
// ============================================================================

export const CreateDocumentInputSchema = z
  .object({
    id: z.string().min(1).max(128).optional(),
    kind: DocumentKindSchema,
    name: z.string().min(1).max(255),
    parentId: z.string().min(1).nullable().default(null),
    body: z.string().max(5_000_000).default(''),
    language: z.string().min(2).max(16).default('en'),
  })
  .strict();
export type CreateDocumentInput = z.infer<typeof CreateDocumentInputSchema>;

export const UpdateDocumentInputSchema = z
  .object({
    docId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    name: z.string().min(1).max(255).optional(),
    body: z.string().max(5_000_000).optional(),
    language: z.string().min(2).max(16).optional(),
  })
  .strict();
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentInputSchema>;

export const MoveDocumentInputSchema = z
  .object({
    docId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    targetParentId: z.string().min(1).nullable(),
  })
  .strict();
export type MoveDocumentInput = z.infer<typeof MoveDocumentInputSchema>;

export const ArchiveDocumentInputSchema = z
  .object({
    docId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    approvalId: z.string().min(1),
    requestMac: z.string().min(1),
  })
  .strict();
export type ArchiveDocumentInput = z.infer<typeof ArchiveDocumentInputSchema>;

export const RestoreDocumentInputSchema = z
  .object({
    docId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export type RestoreDocumentInput = z.infer<typeof RestoreDocumentInputSchema>;

// ============================================================================
// Memory: Chunks & Knowledge Collections (Step 3)
// ============================================================================

export const ChunkSchema = z
  .object({
    id: z.string().min(1),
    docId: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    text: z.string().min(1),
    embedding: z.array(z.number()).min(1).max(3072),
    sha256: z.string().length(64),
  })
  .strict();
export type Chunk = z.infer<typeof ChunkSchema>;

export const KnowledgeCollectionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(120),
    rootFolderId: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type KnowledgeCollection = z.infer<typeof KnowledgeCollectionSchema>;

export const CitationSchema = z
  .object({
    docId: z.string().min(1),
    documentName: z.string().min(1),
    paragraphOrdinal: z.number().int().nonnegative(),
    excerpt: z.string().min(1),
    score: z.number(),
  })
  .strict();
export type Citation = z.infer<typeof CitationSchema>;

export const MemoryAnswerSchema = z
  .object({
    question: z.string().min(1),
    answerMarkdown: z.string().min(1),
    notFound: z.boolean(),
    citations: z.array(CitationSchema),
    model: z.string().min(1),
    latencyMs: z.number().nonnegative(),
  })
  .strict();
export type MemoryAnswer = z.infer<typeof MemoryAnswerSchema>;

// ============================================================================
// App Builder: Closed Component & Workflow Definitions (Steps 4, 5, 7)
// ============================================================================

export const ComponentTypeSchema = z.enum([
  'page',
  'section',
  'tabs',
  'text_field',
  'select',
  'date',
  'number',
  'button',
  'form',
  'table',
  'kanban',
  'calendar',
  'detail_view',
  'metric',
  'markdown_block',
  'agent_chat',
]);
export type ComponentType = z.infer<typeof ComponentTypeSchema>;

export const ActionTypeSchema = z.enum([
  'create_record',
  'update_record',
  'transition_status',
  'archive_record',
  'open_page',
  'ask_agent',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const FieldDefSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
    label: z.string().min(1).max(80),
    type: z.enum(['text', 'select', 'date', 'number']),
    required: z.boolean().default(false),
    options: z.array(z.string().min(1).max(80)).max(50).optional(),
  })
  .strict();
export type FieldDef = z.infer<typeof FieldDefSchema>;

export const ComponentNodeSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: ComponentTypeSchema,
    label: z.string().max(120).optional(),
    fieldKey: z.string().max(64).optional(),
    options: z.array(z.string().min(1).max(80)).max(50).optional(),
    markdown: z.string().max(10_000).optional(),
    action: ActionTypeSchema.optional(),
    targetPageId: z.string().max(64).optional(),
    statusField: z.string().max(64).optional(),
    dateField: z.string().max(64).optional(),
    metricOperation: z.enum(['count', 'sum', 'avg']).optional(),
    collectionIds: z.array(z.string().min(1).max(64)).max(20).optional(),
    childrenIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .strict();
export type ComponentNode = z.infer<typeof ComponentNodeSchema>;

export const StatusTransitionRuleSchema = z
  .object({
    fromStatus: z.string().min(1).max(64),
    toStatus: z.string().min(1).max(64),
    allowedRoles: z.array(z.string().min(1).max(64)).min(1).max(10),
    approverUids: z.array(z.string().min(1).max(128)).max(20).default([]),
  })
  .strict();
export type StatusTransitionRule = z.infer<typeof StatusTransitionRuleSchema>;

export const AppRolePageBindingSchema = z
  .object({
    appRole: z.string().min(1).max(64),
    pageIds: z.array(z.string().min(1).max(64)).min(1).max(50),
  })
  .strict();
export type AppRolePageBinding = z.infer<typeof AppRolePageBindingSchema>;

export const AppDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1).max(120),
    description: z.string().max(500).default(''),
    fields: z.array(FieldDefSchema).max(50),
    components: z.array(ComponentNodeSchema).min(1).max(200),
    rootPageIds: z.array(z.string().min(1).max(64)).min(1).max(20),
    roleBindings: z.array(AppRolePageBindingSchema).max(20).default([]),
    statusTransitions: z.array(StatusTransitionRuleSchema).max(50).default([]),
  })
  .strict();
export type AppDefinition = z.infer<typeof AppDefinitionSchema>;

export const WorkflowTriggerSchema = z
  .object({
    type: z.enum(['webhook', 'schedule']),
    cron: z.string().max(64).optional(),
    webhookId: z.string().max(64).optional(),
  })
  .strict();

export const WorkflowStepSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z.enum(['summarize_collection', 'extract_fields_to_record']),
    collectionIds: z.array(z.string().min(1).max(64)).min(1).max(10),
    promptTemplate: z.string().min(1).max(2000),
    outputFolderId: z.string().min(1).max(128),
  })
  .strict();

export const WorkflowDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1).max(120),
    enabled: z.boolean(),
    trigger: WorkflowTriggerSchema,
    steps: z.array(WorkflowStepSchema).min(1).max(10),
  })
  .strict();
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export const AppSchema = z
  .object({
    id: z.string().min(1),
    draftDefinition: AppDefinitionSchema,
    draftWorkflow: WorkflowDefinitionSchema.nullable(),
    version: z.number().int().positive(),
    publishedSnapshotVersion: z.number().int().positive().nullable(),
    status: z.enum(['draft', 'published', 'archived']),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type App = z.infer<typeof AppSchema>;

export const AppSnapshotSchema = z
  .object({
    version: z.number().int().positive(),
    definition: AppDefinitionSchema,
    workflow: WorkflowDefinitionSchema.nullable(),
    publishedBy: z.string().min(1),
    publishedAt: z.string().datetime(),
  })
  .strict();
export type AppSnapshot = z.infer<typeof AppSnapshotSchema>;

export const StoredAppRecordSchema = z
  .object({
    id: z.string().min(1),
    appId: z.string().min(1),
    bodyCiphertext: z.string().min(1),
    keyVersion: z.number().int().positive(),
    sha256: z.string().length(64),
    version: z.number().int().positive(),
    updatedAt: z.string().datetime(),
    deletedAt: z.string().datetime().nullable(),
  })
  .strict();
export type StoredAppRecord = z.infer<typeof StoredAppRecordSchema>;

export const DecryptedAppRecordSchema = z
  .object({
    id: z.string().min(1),
    appId: z.string().min(1),
    body: z.string(), // Markdown with frontmatter fields + notes
    fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
    notesMarkdown: z.string(),
    keyVersion: z.number().int().positive(),
    sha256: z.string().length(64),
    version: z.number().int().positive(),
    updatedAt: z.string().datetime(),
    deletedAt: z.string().datetime().nullable(),
  })
  .strict();
export type DecryptedAppRecord = z.infer<typeof DecryptedAppRecordSchema>;

// ============================================================================
// Step 5: Builder Agent Validated Diff Proposal Schema
// ============================================================================

export const BuilderDiffProposalSchema = z
  .object({
    appId: z.string().min(1),
    baseVersion: z.number().int().positive(),
    summary: z.string().min(1).max(500),
    proposedDefinition: AppDefinitionSchema,
    addedComponentIds: z.array(z.string()),
    modifiedComponentIds: z.array(z.string()),
    removedComponentIds: z.array(z.string()),
  })
  .strict();
export type BuilderDiffProposal = z.infer<typeof BuilderDiffProposalSchema>;

// ============================================================================
// Step 6: Encrypted Automation Queue Schema
// ============================================================================

export const StoredQueueItemSchema = z
  .object({
    id: z.string().min(1),
    appId: z.string().min(1),
    snapshotVersion: z.number().int().positive(),
    triggerType: z.enum(['webhook', 'schedule']),
    payloadCiphertext: z.string().min(1), // Encrypted with org key + AAD (orgId/queue/itemId)
    keyVersion: z.number().int().positive(),
    status: z.enum(['pending', 'claimed', 'completed', 'failed']),
    attempts: z.number().int().nonnegative(),
    claimedBy: z.string().nullable(),
    leaseExpiresAt: z.string().datetime().nullable(),
    outputDocId: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type StoredQueueItem = z.infer<typeof StoredQueueItemSchema>;

// ============================================================================
// Approvals, Audit Log, Runs
// ============================================================================

export const ConsequentialActionTypeSchema = z.enum([
  'archive_document',
  'archive_record',
  'publish_app',
  'run_model',
  'trigger_external_webhook',
  'transition_record_status',
]);
export type ConsequentialActionType = z.infer<typeof ConsequentialActionTypeSchema>;

export const ApprovalSchema = z
  .object({
    id: z.string().min(1),
    requestMac: z.string().length(64), // Hex HMAC-SHA256 over canonical request
    actor: z.string().min(1),
    action: ConsequentialActionTypeSchema,
    expiresAt: z.string().datetime(),
    used: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type Approval = z.infer<typeof ApprovalSchema>;

export const AuditEventSchema = z
  .object({
    id: z.string().min(1),
    actor: z.string().min(1),
    action: z.string().min(1).max(120),
    targetType: z.enum([
      'organization',
      'member',
      'document',
      'collection',
      'app',
      'record',
      'approval',
      'agent_run',
      'queue',
      'export',
    ]),
    targetId: z.string().min(1),
    appId: z.string().min(1).nullable(),
    appVersion: z.number().int().positive().nullable(),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    createdAt: z.string().datetime(),
  })
  .strict();
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const RunSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(['running', 'succeeded', 'failed']),
    model: z.string().min(1),
    tokens: z.number().int().nonnegative(),
    cost: z.number().nonnegative(),
    latency: z.number().nonnegative(),
    error: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type Run = z.infer<typeof RunSchema>;

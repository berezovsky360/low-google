# LOW Architecture

> **Product Promise:** *Your agents remember, and you own the memory.*

LOW is a multi-tenant platform built on Google Cloud with two halves sharing one store:
1. **Memory**: Company documents, meeting transcripts, and notes stored as Markdown files, with grounded agent Q&A that cites exact source files and paragraphs.
2. **App Builder**: Internal business apps (trackers, CRMs, approval flows) assembled from a closed registry of components and rendered by a deterministic runtime. No generated code ever executes.

---

## Core Architectural Decisions

### 1. Markdown as the Single Source of Truth
- All document bodies (`organizations/{orgId}/documents/{docId}`) and business app records (`organizations/{orgId}/apps/{appId}/records/{recId}`) are authored and exported as plain UTF-8 Markdown.
- Chunks, vector embeddings (`organizations/{orgId}/chunks/{chunkId}`), and search metadata are strictly derived state. Deleting all chunks and running `npm run rebuild-derived` reconstructs the entire semantic index from the decrypted Markdown bodies alone.

### 2. Dual-Enforced Tenant Isolation
- **Layer 1 — Firestore Security Rules ([firestore.rules](file:///Users/berezovsky360/Documents/GRAVITY/firestore.rules))**: Denies any client read or write unless `request.auth.token.orgId == orgId`. Wrapped keys (`keys/{version}`) are completely inaccessible (`allow read, write: if false`) to clients, and `audit/{eventId}` forbids `create`, `update`, and `delete` from clients.
- **Layer 2 — Single Server Repository ([src/adapters/google/firestore-repository.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/adapters/google/firestore-repository.ts))**: Because the Firebase Admin SDK bypasses Security Rules, **no module outside `src/adapters/google/firestore-repository.ts` is permitted to import `firebase-admin/firestore`**. This boundary is enforced by an automated architectural test (`tests/architecture-boundary.test.ts`). Every repository method requires a `VerifiedActor` (`{ uid, orgId, role }`) validated by Zod and scopes all paths under `organizations/{actor.orgId}/…`.

### 3. Envelope Encryption at Rest & Readable-at-Rest Trade-off
- **Per-Organization Data Key**: On an organization's first write, a 256-bit AES-GCM key is generated, wrapped by Cloud KMS (`LOW_KMS_KEY_NAME`) with Additional Authenticated Data (`org:{orgId}:key-v:{version}`), and stored in `organizations/{orgId}/keys/{version}`.
- **Per-Document Ciphertext Binding (AAD)**: Every Markdown body (`bodyCiphertext` on `documents/{docId}`, `documents/{docId}/versions/{n}`, and `apps/{appId}/records/{recId}`) is encrypted using AES-256-GCM (12-byte random IV, 16-byte authentication tag) with AAD set to `${orgId}/${documentId}`.
  - **Security Property**: If a raw `bodyCiphertext` is copied into another organization's document or even another document ID within the same organization, GCM authentication fails and decryption throws `CiphertextIntegrityError`.
- **What Remains Readable at Rest (Trade-off)**:
  - **Encrypted at rest (application-layer AES-256-GCM)**: `documents.bodyCiphertext`, `documents/versions.bodyCiphertext`, `apps/records.bodyCiphertext`, and automation `queue` payloads.
  - **Readable at rest in Firestore (protected by Google default disk encryption + tenant isolation rules)**:
    1. Document structural metadata (`name`, `kind`, `parentId`, `ancestors`, `sha256`, `sizeBytes`, `language`, `version`, `updatedAt`, `deletedAt`) so folder trees and version lists can be rendered without decrypting every file body.
    2. Derived chunk text and vector embeddings (`chunks/{chunkId}: text, embedding, docId, ordinal`) so Firestore Native Vector Search can compute cosine/dot-product similarity and return grounded passages directly.
    3. App and workflow definitions (`apps/{appId}` and `snapshots/{n}`), approvals, runs, and audit metadata.

### 4. Optimistic Concurrency Control (`expectedVersion`)
- Every mutation to an existing document or record (`updateDocument`, `moveDocument`, `archiveDocument`, `restoreDocument`) runs inside a Firestore transaction and compares `current.version === input.expectedVersion`.
- If a concurrent write incremented the version, the transaction aborts with `VersionConflictError`. Silent merges never occur.

### 5. Single-Use HMAC Approvals for Consequential Actions
- Archiving documents/records, publishing apps, paid model invocations, status transitions requiring named approvers, and external webhooks require a pre-issued `Approval` (`organizations/{orgId}/approvals/{approvalId}`).
- The approval stores `requestMac = HMAC-SHA256(LOW_APPROVAL_SECRET, canonical({ orgId, actor, action, payload }))`, an `expiresAt` timestamp, and `used: false`.
- Inside the action's Firestore transaction, the repository verifies that `used === false`, `expiresAt > now`, and `requestMac` matches the exact request parameters in constant time (`timingSafeEqual`), then sets `used: true` atomically alongside the mutation.

### 6. Append-Only Audit Log
- Every consequential action (`organization.create`, `document.create.*`, `document.update`, `document.move`, `document.archive`, `document.restore`, `approval.issue.*`, app publishes, agent runs) appends an `AuditEvent` in the same transaction via `tx.create(...)`.
- Neither `firestore.rules` nor `FirestoreRepository` exposes any update or delete operation on `organizations/{orgId}/audit/{eventId}`.

### 7. Replaceable Port Interfaces & Self-Hosting
- All external infrastructure sits behind interfaces in [src/ports/interfaces.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/ports/interfaces.ts): `DocumentStore`, `ObjectStore`, `KeyProvider`, `Transcriber`, `Embedder`, `ModelProvider`, and `IdentityProvider`.
- Local development uses `docker compose` with the Firebase Emulator Suite and `LocalKmsEmulatorKeyProvider`. Production self-hosting without Google Cloud services only requires swapping in PostgreSQL + S3 + Vault/local KEK implementations of these seven interfaces.

---

## Implementation Status

- [x] **Step 1 (Workspace & Backend Foundation)**: Data model (`src/domain/schemas.ts`), Firestore Security Rules (`firestore.rules`), replaceable port interfaces (`src/ports/interfaces.ts`), AES-256-GCM + AAD crypto (`src/security/crypto.ts`), single-use HMAC approvals (`src/security/approvals.ts`), single server repository module (`src/adapters/google/firestore-repository.ts`), and Vault UI (Bento Grid, Markdown Editor, List, 2026 Calendar, Knowledge Graph, Version History, Bin/Restore).
- [x] **Step 2 (Capture)**: Upload audio/documents (`src/services/capture-service.ts`), Gemini transcription (`src/adapters/google/gemini-providers.ts`), and Markdown filing into Vault folders.
- [x] **Step 3 (Memory)**: Knowledge collections, deterministic paragraph chunking + Gemini embeddings flow (`src/services/memory-service.ts`), vector search with `[docId §ordinal]` citations, `"Not found"` anti-hallucination guard, and `scripts/rebuild-derived.ts`.
- [x] **Step 4 (App Builder)**: 16 registered components (`page`, `section`, `tabs`, `text_field`, `select`, `date`, `number`, `button`, `form`, `table`, `kanban`, `calendar`, `detail_view`, `metric`, `markdown_block`, `agent_chat`), encrypted Markdown records (`src/domain/markdown-records.ts`), draft/preview/publish immutable snapshots.
- [x] **Step 5 (Builder Agent)**: Read/validate/preview diff conversation flow (`src/services/builder-agent-service.ts`) with explicit user approval before applying.
- [x] **Step 6 (Automation)**: Encrypted Firestore queue and transactional Cloud Run Job worker (`src/services/automation-worker.ts`) with lease expiration retry and single deterministic output guarantee.
- [x] **Step 7 (Roles & Audit)**: App-level roles, named approvers for status transitions (`@berezovsky360`), and append-only audit log viewer.
- [x] **Step 8 (Export)**: Full organization portable `.zip` export (`src/services/export-service.ts`, `/api/export`) containing live readable Markdown files and JSON definitions (never ciphertext).

### Future Work (Self-Hosted Non-Google Cloud Adapters)
- Production PostgreSQL + `pgvector` implementation of `DocumentStore`.
- Production S3/MinIO implementation of `ObjectStore`.
- Production HashiCorp Vault / PKCS#11 implementation of `KeyProvider`.

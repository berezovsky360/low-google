# LOW on Google Cloud

> **Your agents remember, and you own the memory.**

LOW is a multi-tenant enterprise workspace and internal application platform built on **Google Cloud** with two halves that share one store:

1. **Memory (`Vault` + Grounded Q&A)**: A company's documents, voice transcripts, and notes are kept as plain **Markdown** files, encrypted at rest under per-organization AES-256-GCM keys wrapped by **Google Cloud KMS**. AI agents answer questions strictly from declared knowledge collections and cite the exact `docId` and paragraph (`§ordinal`).
2. **Deterministic App Builder (`Code`)**: On top of the same corpus, owners assemble internal business apps (CRMs, trackers, approval flows) from a closed palette of 16 registered components validated by `.strict()` Zod schemas. **No generated code, raw HTML, or MDX ever executes.**

---

## Quick Start for Hackathon Judges

```bash
npm install
npm test            # Runs all 16 automated security, grounding & concurrency tests
npm run typecheck   # Strict TypeScript verification
npm run dev         # Starts the LOW web application on http://localhost:3000
```

### Interactive Judge Features in the UI
- **1-Click Tenant Switcher (Top Right `@berezovsky360`)**: Switch live between **Tenant A (`org-berezovsky`)** and **Tenant B (`org-beta`)** to verify multi-tenant isolation.
- **Hackathon Judge Console (Top Bar Pill)**: Interactive dashboard verifying:
  1. **Markdown Source of Truth & Derived Index Rebuild** (`npm run rebuild-derived` / live UI button).
  2. **At-Rest Ciphertext & AAD Inspector** (click the lock icon in the Markdown Editor to view raw `bodyCiphertext` bound to `orgId/docId`).
  3. **Grounded Memory Q&A & Anti-Hallucination Evaluation** (preset grounded questions with `[docId §ordinal]` citations + ungrounded questions returning `"Not found"`).
  4. **Deterministic App Builder, Builder Agent Diff Preview, Cloud Run Automation Queue Worker, Append-Only Audit Log, and 1-Click `.zip` Export**.

---

## Non-Negotiable Principles & Where They Are Enforced

| Principle | Implementation | Automated Test |
|---|---|---|
| **1. Markdown is the source of truth** | [scripts/rebuild-derived.ts](file:///Users/berezovsky360/Documents/GRAVITY/scripts/rebuild-derived.ts), [memory-service.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/services/memory-service.ts) | `acceptance-all.test.ts` #4 |
| **2. Tenant isolation enforced twice** | [firestore.rules](file:///Users/berezovsky360/Documents/GRAVITY/firestore.rules) + single server repository [firestore-repository.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/adapters/google/firestore-repository.ts) | `step1-foundation.test.ts` #1, #2, #3 & `acceptance-all.test.ts` #1 |
| **3. No generated code executes** | Closed `.strict()` Zod schemas in [schemas.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/domain/schemas.ts) + `react-markdown` | `acceptance-all.test.ts` #6 |
| **4. Consequential actions need an approval** | Single-use HMAC-SHA256 in [approvals.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/security/approvals.ts) consumed in the same Firestore transaction | `acceptance-all.test.ts` #7 |
| **5. Everything consequential is audited** | Append-only `organizations/{orgId}/audit/{eventId}` (`tx.create` only; no update/delete exists) | `step1-foundation.test.ts` #2, #6 |
| **6. Per-organization envelope encryption** | AES-256-GCM wrapped by Cloud KMS ([kms-key-provider.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/adapters/google/kms-key-provider.ts)) + AAD `orgId/documentId` ([crypto.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/security/crypto.ts)) | `acceptance-all.test.ts` #2, #3 |
| **7. Leaving is a download** | [export-service.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/services/export-service.ts) & `/api/export` produce a `.zip` of plain Markdown + JSON definitions | `acceptance-all.test.ts` #10 |
| **8. Replaceable adapter interfaces** | [interfaces.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/ports/interfaces.ts) (`DocumentStore`, `ObjectStore`, `KeyProvider`, `Transcriber`, `Embedder`, `ModelProvider`, `IdentityProvider`) | Full suite |

---

## Self-Hosting & Local Development (`docker compose`)

```bash
docker compose up --build
```

> **Important Note on Emulators vs. Production Self-Hosting:**
> The `docker-compose.yml` configuration uses the **Firebase Emulator Suite**, which is intended **for local development and automated testing only**.
> Because Firestore, Firebase Authentication, and Cloud KMS are managed Google Cloud services, **production self-hosting on non-Google infrastructure requires the PostgreSQL (`DocumentStore`), S3-compatible (`ObjectStore`), and Vault/Local KEK (`KeyProvider`) adapter implementations** behind the interfaces in `src/ports/interfaces.ts` (listed as future work in `ARCHITECTURE.md`).

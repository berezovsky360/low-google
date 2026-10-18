import { FirestoreRepository } from '../adapters/google/firestore-repository';
import { InMemoryObjectStore } from '../adapters/google/gcs-object-store';
import {
  GeminiEmbedder,
  GeminiModelProvider,
  GeminiTranscriber,
} from '../adapters/google/gemini-providers';
import { LocalKmsEmulatorKeyProvider } from '../adapters/google/kms-key-provider';
import type { VerifiedActor } from '../domain/schemas';
import { AutomationWorker } from '../services/automation-worker';
import {
  BuilderAgentService,
  buildTemplateDefinition,
} from '../services/builder-agent-service';
import { CaptureService } from '../services/capture-service';
import { ExportService } from '../services/export-service';
import { MemoryService } from '../services/memory-service';
import { createInMemoryFirestore } from '../../tests/helpers/in-memory-firestore';

export interface ServerContainer {
  store: FirestoreRepository;
  memoryService: MemoryService;
  captureService: CaptureService;
  builderAgentService: BuilderAgentService;
  automationWorker: AutomationWorker;
  exportService: ExportService;
  dumpRawDoc: (path: string) => Record<string, unknown> | undefined;
  ensureSeeded: () => Promise<void>;
}

const globalForLow = globalThis as unknown as {
  __lowServerContainer?: ServerContainer;
  __lowSeedPromise?: Promise<void>;
};

export function getServerContainer(): ServerContainer {
  if (globalForLow.__lowServerContainer) {
    return globalForLow.__lowServerContainer;
  }

  const reasoningModel = process.env.LOW_REASONING_MODEL ?? 'gemini-2.5-flash';
  const transcriptionModel =
    process.env.LOW_TRANSCRIPTION_MODEL ?? 'gemini-2.5-flash';
  const embeddingModel =
    process.env.LOW_EMBEDDING_MODEL ?? 'text-embedding-004';

  const { db, dumpRawDoc } = createInMemoryFirestore();
  const keyProvider = new LocalKmsEmulatorKeyProvider();
  const store = new FirestoreRepository({ db, keyProvider });
  const objectStore = new InMemoryObjectStore();
  const embedder = new GeminiEmbedder(embeddingModel);
  const transcriber = new GeminiTranscriber(transcriptionModel);
  const modelProvider = new GeminiModelProvider(reasoningModel);

  const memoryService = new MemoryService(store, embedder, modelProvider);
  const captureService = new CaptureService(
    store,
    objectStore,
    transcriber,
    memoryService
  );
  const builderAgentService = new BuilderAgentService(store);
  const automationWorker = new AutomationWorker(store, memoryService);
  const exportService = new ExportService(store);

  const ensureSeeded = async () => {
    if (!globalForLow.__lowSeedPromise) {
      globalForLow.__lowSeedPromise = seedJudgeDemoData(
        store,
        memoryService
      );
    }
    await globalForLow.__lowSeedPromise;
  };

  const container: ServerContainer = {
    store,
    memoryService,
    captureService,
    builderAgentService,
    automationWorker,
    exportService,
    dumpRawDoc,
    ensureSeeded,
  };

  globalForLow.__lowServerContainer = container;
  return container;
}

async function seedJudgeDemoData(
  store: FirestoreRepository,
  memoryService: MemoryService
): Promise<void> {
  const ownerActor: VerifiedActor = {
    uid: 'berezovsky360',
    orgId: 'org-berezovsky',
    role: 'owner',
    email: 'berezovsky360@low.cloud',
  };

  const existingOrg = await store.getOrganization(ownerActor);
  if (existingOrg) {
    return;
  }

  await store.createOrganization({
    orgId: 'org-berezovsky',
    name: 'LOW Vault (@berezovsky360)',
    ownerUid: ownerActor.uid,
    ownerEmail: ownerActor.email,
    ownerDisplayName: '@berezovsky360',
  });

  // Create the `test` folder shown in the screenshots
  const testFolder = await store.createDocument(ownerActor, {
    id: 'folder-test',
    kind: 'folder',
    name: 'test',
    parentId: null,
    body: '',
    language: 'en',
  });

  // Create the exact 4 Markdown files inside `test/` + 1 root Markdown file from the screenshots
  const doc1 = await store.createDocument(ownerActor, {
    id: '2026-09-02-12-12-16',
    kind: 'file',
    name: '2026-09-02 12-12-16.md',
    parentId: testFolder.id,
    body: [
      '# LOW Cloud Architecture & Security Policy',
      '',
      'Every organization has a dedicated AES-256-GCM data key generated on first write and wrapped by Google Cloud KMS.',
      '',
      'Document bodies are bound via Additional Authenticated Data (AAD) to orgId/documentId so ciphertext copied across tenants never decrypts.',
      '',
      'Production incidents must be escalated to the on-call security lead within 30 minutes.',
    ].join('\n'),
    language: 'en',
  });

  const doc2 = await store.createDocument(ownerActor, {
    id: '2026-09-07-19-45-11',
    kind: 'file',
    name: '2026-09-07 19-45-11.md',
    parentId: testFolder.id,
    body: [
      '# Enterprise Customer Onboarding & SLA',
      '',
      'Enterprise customers receive a 99.95% uptime SLA deployed on Google Cloud Run with min-instances=1.',
      '',
      'All consequential actions—including archiving records, publishing apps, and paid model runs—require a single-use HMAC-SHA256 approval.',
    ].join('\n'),
    language: 'en',
  });

  const doc3 = await store.createDocument(ownerActor, {
    id: '2026-09-07-19-45-13',
    kind: 'file',
    name: '2026-09-07 19-45-13.md',
    parentId: testFolder.id,
    body: [
      '# Q3 Product & App Builder Roadmap',
      '',
      'Internal business apps are assembled from 16 registered components validated by closed Zod strict schemas.',
      '',
      'No generated code, raw HTML, or MDX ever executes in the runtime. Leaving LOW is a single one-click zip download of plain Markdown and JSON definitions.',
    ].join('\n'),
    language: 'en',
  });

  const doc4 = await store.createDocument(ownerActor, {
    id: '2026-09-07-19-45-14',
    kind: 'file',
    name: '2026-09-07 19-45-14.md',
    parentId: testFolder.id,
    body: [
      '# Treasury & Procurement Approval Rules',
      '',
      'Vendor contracts exceeding $25,000 require explicit approval from @berezovsky360 before status transitions to Approved.',
      '',
      'All procurement records are stored as encrypted Markdown files inside the organization store.',
    ].join('\n'),
    language: 'en',
  });

  const doc5 = await store.createDocument(ownerActor, {
    id: '2026-09-07-19-45-33',
    kind: 'file',
    name: '2026-09-07 19-45-33.md',
    parentId: null,
    body: 'Делай там оцифровку видите то все что-то говорю у меня там что-то происходит вот типа вот какие-то такие штуки типа',
    language: 'ru',
  });

  for (const d of [doc1, doc2, doc3, doc4, doc5]) {
    await memoryService.indexDocument(ownerActor, d);
  }

  // Register `test` folder as a Knowledge Collection
  await store.createKnowledgeCollection(ownerActor, {
    id: 'col-vault-test',
    name: 'Core Company Memory (test/)',
    rootFolderId: testFolder.id,
  });

  // Seed an Internal Deal & Approval Tracker App (Step 4, 5, 6, 7)
  const app = await store.saveAppDraft(ownerActor, {
    appId: 'app-crm-approvals',
    definition: {
      schemaVersion: 1,
      name: 'Enterprise Deal & Approval Tracker',
      description:
        'Deterministic internal CRM & approval workflow built on encrypted Markdown records.',
      fields: [
        { key: 'title', label: 'Deal / Request Name', type: 'text', required: true },
        {
          key: 'status',
          label: 'Stage',
          type: 'select',
          required: true,
          options: ['Draft', 'In Review', 'Approved', 'Archived'],
        },
        { key: 'amount', label: 'Contract Value ($)', type: 'number', required: true },
        { key: 'dueDate', label: 'Target Close Date', type: 'date', required: false },
      ],
      components: [
        {
          id: 'page-overview',
          type: 'page',
          label: 'Pipeline & Approvals',
          childrenIds: [
            'metric-total-value',
            'metric-deal-count',
            'kanban-pipeline',
            'table-records',
            'calendar-schedule',
            'markdown-policy',
            'chat-copilot',
          ],
        },
        {
          id: 'metric-total-value',
          type: 'metric',
          label: 'Total Pipeline Value ($)',
          fieldKey: 'amount',
          metricOperation: 'sum',
        },
        {
          id: 'metric-deal-count',
          type: 'metric',
          label: 'Active Deals',
          fieldKey: 'amount',
          metricOperation: 'count',
        },
        {
          id: 'kanban-pipeline',
          type: 'kanban',
          label: 'Approval Stage Kanban',
          statusField: 'status',
        },
        {
          id: 'table-records',
          type: 'table',
          label: 'All Encrypted Markdown Records',
        },
        {
          id: 'calendar-schedule',
          type: 'calendar',
          label: 'Close Date Calendar',
          dateField: 'dueDate',
        },
        {
          id: 'markdown-policy',
          type: 'markdown_block',
          label: 'Governance Banner',
          markdown:
            '> **Governance Rule:** Contracts above $25,000 require named approver `@berezovsky360` and a single-use HMAC approval token.',
        },
        {
          id: 'chat-copilot',
          type: 'agent_chat',
          label: 'Grounded Memory Assistant',
          collectionIds: ['col-vault-test'],
        },
      ],
      rootPageIds: ['page-overview'],
      roleBindings: [
        { appRole: 'owner', pageIds: ['page-overview'] },
        { appRole: 'admin', pageIds: ['page-overview'] },
        { appRole: 'member', pageIds: ['page-overview'] },
      ],
      statusTransitions: [
        {
          fromStatus: 'Draft',
          toStatus: 'In Review',
          allowedRoles: ['owner', 'admin', 'member'],
          approverUids: [],
        },
        {
          fromStatus: 'In Review',
          toStatus: 'Approved',
          allowedRoles: ['owner', 'admin'],
          approverUids: ['berezovsky360'],
        },
      ],
    },
    workflow: {
      schemaVersion: 1,
      name: 'Weekly Executive Pipeline Digest',
      enabled: true,
      trigger: { type: 'schedule', cron: '0 8 * * 1' },
      steps: [
        {
          id: 'step-digest',
          type: 'summarize_collection',
          collectionIds: ['col-vault-test'],
          promptTemplate:
            'Summarize active enterprise deals, security compliance, and SLA commitments into a weekly Markdown briefing.',
          outputFolderId: testFolder.id,
        },
      ],
    },
  });

  const pubApproval = await store.issueApproval(ownerActor, {
    action: 'publish_app',
    canonicalPayload: { appId: app.id, expectedVersion: app.version },
  });
  await store.publishApp(ownerActor, {
    appId: app.id,
    expectedVersion: app.version,
    approvalId: pubApproval.id,
    requestMac: pubApproval.requestMac,
  });

  await store.createAppRecord(ownerActor, {
    appId: app.id,
    recId: 'deal-cloud-kms',
    fields: {
      title: 'Acme Financial — Multi-Region KMS Vault',
      status: 'Approved',
      amount: 48000,
      dueDate: '2026-09-07',
    },
    notesMarkdown:
      'Signed annual deployment on Cloud Run (`min-instances=1`) with dedicated Cloud KMS key ring.',
  });

  await store.createAppRecord(ownerActor, {
    appId: app.id,
    recId: 'deal-vertex-search',
    fields: {
      title: 'Northstar Logistics — Grounded Memory Rollout',
      status: 'In Review',
      amount: 32500,
      dueDate: '2026-09-02',
    },
    notesMarkdown:
      'Awaiting final security review and CFO sign-off for Q4 deployment.',
  });

  await store.createAppRecord(ownerActor, {
    appId: app.id,
    recId: 'deal-self-host',
    fields: {
      title: 'Helios Biotech — Portable Markdown Archive',
      status: 'Draft',
      amount: 18000,
      dueDate: '2026-09-14',
    },
    notesMarkdown: 'Evaluating self-hosted Docker deployment and one-click zip export.',
  });

  // 2. Inventory & Stock Manager App
  const invApp = await store.saveAppDraft(ownerActor, {
    appId: 'app-inventory',
    definition: buildTemplateDefinition('Inventory & Stock Manager'),
    workflow: {
      schemaVersion: 1,
      name: 'Daily Stock & Reorder Digest',
      enabled: true,
      trigger: { type: 'schedule', cron: '0 7 * * *' },
      steps: [
        {
          id: 'step-stock-digest',
          type: 'summarize_collection',
          collectionIds: ['col-vault-test'],
          promptTemplate:
            'Summarize low stock SKUs and supplier reorder items into a Markdown report.',
          outputFolderId: testFolder.id,
        },
      ],
    },
  });

  const invApproval = await store.issueApproval(ownerActor, {
    action: 'publish_app',
    canonicalPayload: { appId: invApp.id, expectedVersion: invApp.version },
  });
  await store.publishApp(ownerActor, {
    appId: invApp.id,
    expectedVersion: invApp.version,
    approvalId: invApproval.id,
    requestMac: invApproval.requestMac,
  });

  await store.createAppRecord(ownerActor, {
    appId: invApp.id,
    recId: 'sku-h100-rack',
    fields: {
      title: 'NVIDIA H100 Node Rack (SKU-8840)',
      status: 'In Stock',
      amount: 14,
      dueDate: '2026-09-20',
    },
    notesMarkdown: 'Warehouse A-12. Reserved for Q4 private cloud cluster.',
  });

  await store.createAppRecord(ownerActor, {
    appId: invApp.id,
    recId: 'sku-coral-tpu',
    fields: {
      title: 'Google Coral Edge TPU Dev Kit (SKU-2190)',
      status: 'Low Stock',
      amount: 3,
      dueDate: '2026-09-05',
    },
    notesMarkdown: 'Below minimum threshold (10 units). Trigger supplier PO.',
  });

  await store.createAppRecord(ownerActor, {
    appId: invApp.id,
    recId: 'sku-starlink-ent',
    fields: {
      title: 'Starlink Enterprise Terminal (SKU-5510)',
      status: 'Reordered',
      amount: 25,
      dueDate: '2026-09-12',
    },
    notesMarkdown: 'Purchase order #PO-9941 confirmed; ETA Sept 12.',
  });

  // Also seed Tenant B (`org-beta`) to demonstrate strict tenant isolation live
  const betaActor: VerifiedActor = {
    uid: 'beta_admin',
    orgId: 'org-beta',
    role: 'owner',
    email: 'admin@betalabs.io',
  };

  await store.createOrganization({
    orgId: 'org-beta',
    name: 'Beta Labs (Isolated Tenant B)',
    ownerUid: betaActor.uid,
    ownerEmail: betaActor.email,
    ownerDisplayName: '@beta_admin',
  });

  await store.createDocument(betaActor, {
    id: 'beta-confidential',
    kind: 'file',
    name: 'beta-proprietary-formula.md',
    parentId: null,
    body: '# Beta Labs Confidential\nThis document is encrypted under Org Beta’s KMS-wrapped key and is invisible to @berezovsky360.',
    language: 'en',
  });
}

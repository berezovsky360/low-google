import { describe, expect, it } from 'vitest';
import { runRebuildDerivedForOrg } from '../scripts/rebuild-derived';
import { FirestoreRepository } from '../src/adapters/google/firestore-repository';
import { GeminiEmbedder, GeminiModelProvider } from '../src/adapters/google/gemini-providers';
import { LocalKmsEmulatorKeyProvider } from '../src/adapters/google/kms-key-provider';
import {
  ApprovalVerificationError,
  CiphertextIntegrityError,
  VersionConflictError,
} from '../src/domain/errors';
import { AppDefinitionSchema, type VerifiedActor } from '../src/domain/schemas';
import { AutomationWorker } from '../src/services/automation-worker';
import { ExportService } from '../src/services/export-service';
import { MemoryService } from '../src/services/memory-service';
import { createInMemoryFirestore } from './helpers/in-memory-firestore';

const TEST_REASONING_MODEL = process.env.LOW_REASONING_MODEL ?? 'gemini-2.5-flash';
const TEST_EMBEDDING_MODEL = process.env.LOW_EMBEDDING_MODEL ?? 'text-embedding-004';

function createTestEnvironment() {
  const { db, dumpRawDoc, setRawDoc } = createInMemoryFirestore();
  const keyProvider = new LocalKmsEmulatorKeyProvider();
  const store = new FirestoreRepository({ db, keyProvider });
  const embedder = new GeminiEmbedder(TEST_EMBEDDING_MODEL);
  const modelProvider = new GeminiModelProvider(TEST_REASONING_MODEL);
  const memoryService = new MemoryService(store, embedder, modelProvider);
  const automationWorker = new AutomationWorker(store, memoryService);
  const exportService = new ExportService(store);

  return {
    db,
    dumpRawDoc,
    setRawDoc,
    store,
    embedder,
    modelProvider,
    memoryService,
    automationWorker,
    exportService,
  };
}

describe('LOW Full Acceptance Suite (All 10 Mandatory Tests)', () => {
  it('1. A member of organization A cannot read, list, write or search anything in organization B', async () => {
    const { store, memoryService } = createTestEnvironment();

    const actorA: VerifiedActor = { uid: 'alice', orgId: 'org-a', role: 'owner' };
    const actorB: VerifiedActor = { uid: 'bob', orgId: 'org-b', role: 'owner' };

    await store.createOrganization({ orgId: 'org-a', name: 'Org A', ownerUid: actorA.uid });
    await store.createOrganization({ orgId: 'org-b', name: 'Org B', ownerUid: actorB.uid });

    const folderB = await store.createDocument(actorB, {
      id: 'folder-b',
      kind: 'folder',
      name: 'vault-b',
      parentId: null,
      body: '',
      language: 'en',
    });

    const docB = await store.createDocument(actorB, {
      id: 'doc-b-1',
      kind: 'file',
      name: 'treasury-policy.md',
      parentId: folderB.id,
      body: '# Treasury Policy\nWire transfers above $50,000 require CFO approval.',
      language: 'en',
    });

    await memoryService.indexDocument(actorB, docB);
    const colB = await store.createKnowledgeCollection(actorB, {
      id: 'col-b',
      name: 'Finance Knowledge',
      rootFolderId: folderB.id,
    });

    // Member of Org A cannot read Org B's document
    expect(await store.getDocument(actorA, docB.id)).toBeNull();

    // Member of Org A cannot list Org B's documents
    expect(await store.listDocuments(actorA)).toHaveLength(0);

    // Member of Org A cannot update or move Org B's document
    await expect(
      store.updateDocument(actorA, {
        docId: docB.id,
        expectedVersion: 1,
        body: 'Tampered',
      })
    ).rejects.toThrow(/not found/i);

    // Member of Org A cannot search Org B's vector chunks even when supplying Org B's collectionId
    const searchByA = await memoryService.askQuestion(actorA, {
      question: 'What is the wire transfer approval threshold?',
      collectionIds: [colB.id],
    });
    expect(searchByA.notFound).toBe(true);
    expect(searchByA.citations).toHaveLength(0);
  });

  it('2 & 3. A document body read straight from Firestore is ciphertext, read by owner is Markdown, and copied to another org fails to decrypt', async () => {
    const { store, dumpRawDoc, setRawDoc } = createTestEnvironment();

    const actorA: VerifiedActor = { uid: 'alice', orgId: 'org-a', role: 'owner' };
    const actorB: VerifiedActor = { uid: 'bob', orgId: 'org-b', role: 'owner' };

    await store.createOrganization({ orgId: 'org-a', name: 'Org A', ownerUid: actorA.uid });
    await store.createOrganization({ orgId: 'org-b', name: 'Org B', ownerUid: actorB.uid });

    const originalMarkdown = '# Architecture Notes\nAll bodies are encrypted with AES-256-GCM.';
    await store.createDocument(actorA, {
      id: 'arch-doc',
      kind: 'file',
      name: 'arch.md',
      parentId: null,
      body: originalMarkdown,
      language: 'en',
    });

    const raw = dumpRawDoc('organizations/org-a/documents/arch-doc');
    expect(raw).toBeDefined();
    expect(typeof raw?.bodyCiphertext).toBe('string');
    expect((raw?.bodyCiphertext as string).length).toBeGreaterThan(32);
    expect(raw?.bodyCiphertext).not.toContain('Architecture Notes');

    const readByOwner = await store.getDocument(actorA, 'arch-doc');
    expect(readByOwner?.body).toBe(originalMarkdown);

    // Copy ciphertext into Org B's document
    await store.createDocument(actorB, {
      id: 'arch-doc',
      kind: 'file',
      name: 'arch.md',
      parentId: null,
      body: 'Initial B',
      language: 'en',
    });
    const rawB = dumpRawDoc('organizations/org-b/documents/arch-doc')!;
    setRawDoc('organizations/org-b/documents/arch-doc', {
      ...rawB,
      bodyCiphertext: raw!.bodyCiphertext,
    });

    await expect(store.getDocument(actorB, 'arch-doc')).rejects.toThrow(
      CiphertextIntegrityError
    );
  });

  it('4. Deleting every chunk and embedding, then running the rebuild script, restores identical search results for a fixed question set', async () => {
    const { store, memoryService } = createTestEnvironment();
    const actor: VerifiedActor = { uid: 'alice', orgId: 'org-a', role: 'owner' };
    await store.createOrganization({ orgId: 'org-a', name: 'Org A', ownerUid: actor.uid });

    const folder = await store.createDocument(actor, {
      id: 'handbook-folder',
      kind: 'folder',
      name: 'handbook',
      parentId: null,
      body: '',
      language: 'en',
    });

    const doc1 = await store.createDocument(actor, {
      id: 'security-policy',
      kind: 'file',
      name: 'security-policy.md',
      parentId: folder.id,
      body: [
        '# Security Policy',
        '',
        'Every organization data key uses AES-256-GCM and is wrapped by Google Cloud KMS.',
        '',
        'Production incidents must be reported to the security team within 30 minutes of detection.',
      ].join('\n'),
      language: 'en',
    });

    const doc2 = await store.createDocument(actor, {
      id: 'onboarding-guide',
      kind: 'file',
      name: 'onboarding-guide.md',
      parentId: folder.id,
      body: [
        '# Onboarding Guide',
        '',
        'New engineers receive hardware keys and VPN access on their first Monday.',
        '',
        'Code reviews require approval from at least one code owner before merging.',
      ].join('\n'),
      language: 'en',
    });

    await memoryService.indexDocument(actor, doc1);
    await memoryService.indexDocument(actor, doc2);

    const collection = await store.createKnowledgeCollection(actor, {
      id: 'company-handbook',
      name: 'Company Handbook',
      rootFolderId: folder.id,
    });

    const fixedQuestions = [
      'How quickly must production incidents be reported to the security team?',
      'What encryption algorithm wraps organization data keys?',
      'What is required before merging code reviews?',
    ];

    const beforeRebuild = await Promise.all(
      fixedQuestions.map((question) =>
        memoryService.askQuestion(actor, {
          question,
          collectionIds: [collection.id],
        })
      )
    );

    // Delete all chunks and verify index is empty
    const deletedCount = await store.deleteAllDerivedChunks(actor);
    expect(deletedCount).toBeGreaterThan(0);
    expect(await store.listChunks(actor)).toHaveLength(0);

    // Run the rebuild script
    const rebuildResult = await runRebuildDerivedForOrg({
      actor,
      store,
      embeddingModel: TEST_EMBEDDING_MODEL,
      reasoningModel: TEST_REASONING_MODEL,
    });
    expect(rebuildResult.rebuiltDocuments).toBe(2);
    expect(rebuildResult.rebuiltChunks).toBe(deletedCount);

    // Re-run the exact same fixed question set and verify identical citations and answers
    const afterRebuild = await Promise.all(
      fixedQuestions.map((question) =>
        memoryService.askQuestion(actor, {
          question,
          collectionIds: [collection.id],
        })
      )
    );

    for (let i = 0; i < fixedQuestions.length; i++) {
      expect(afterRebuild[i]?.notFound).toBe(false);
      expect(afterRebuild[i]?.answerMarkdown).toBe(beforeRebuild[i]?.answerMarkdown);
      expect(afterRebuild[i]?.citations).toEqual(beforeRebuild[i]?.citations);
    }
  });

  it('5. An answer whose question is not covered by the collection returns "not found" rather than an invented answer, on a fixed evaluation set', async () => {
    const { store, memoryService } = createTestEnvironment();
    const actor: VerifiedActor = { uid: 'alice', orgId: 'org-a', role: 'owner' };
    await store.createOrganization({ orgId: 'org-a', name: 'Org A', ownerUid: actor.uid });

    const folder = await store.createDocument(actor, {
      id: 'eng-docs',
      kind: 'folder',
      name: 'eng-docs',
      parentId: null,
      body: '',
      language: 'en',
    });

    const doc = await store.createDocument(actor, {
      id: 'deploy-runbook',
      kind: 'file',
      name: 'deploy-runbook.md',
      parentId: folder.id,
      body: '# Deployment Runbook\nDeployments run on Cloud Run in us-central1 with min-instances=1.',
      language: 'en',
    });

    await memoryService.indexDocument(actor, doc);
    const col = await store.createKnowledgeCollection(actor, {
      id: 'eng-col',
      name: 'Engineering Docs',
      rootFolderId: folder.id,
    });

    const ungroundedEvaluationSet = [
      'What is the dental insurance deductible for dependents in 2026?',
      'Which catering vendor provides Friday lunch in the Tokyo office?',
      'What is the stock ticker symbol of our parent holding company?',
    ];

    for (const question of ungroundedEvaluationSet) {
      const res = await memoryService.askQuestion(actor, {
        question,
        collectionIds: [col.id],
      });
      expect(res.notFound).toBe(true);
      expect(res.answerMarkdown.toLowerCase()).toContain('not found');
      expect(res.citations).toHaveLength(0);
    }
  });

  it('6. An AppDefinition with an unknown component type or an extra property is rejected with a message naming the field', () => {
    const badType = AppDefinitionSchema.safeParse({
      schemaVersion: 1,
      name: 'Tracker',
      fields: [],
      components: [{ id: 'x1', type: 'arbitrary_iframe' }],
      rootPageIds: ['x1'],
    });
    expect(badType.success).toBe(false);
    if (!badType.success) {
      expect(JSON.stringify(badType.error.issues)).toContain('type');
    }

    const extraProp = AppDefinitionSchema.safeParse({
      schemaVersion: 1,
      name: 'Tracker',
      fields: [],
      components: [{ id: 'p1', type: 'page', customJsCode: 'window.location="evil"' }],
      rootPageIds: ['p1'],
    });
    expect(extraProp.success).toBe(false);
    if (!extraProp.success) {
      expect(JSON.stringify(extraProp.error.issues)).toContain('customJsCode');
    }
  });

  it('7. A replayed approval, an altered approval and an expired approval all fail', async () => {
    const { store } = createTestEnvironment();
    const actor: VerifiedActor = { uid: 'alice', orgId: 'org-a', role: 'owner' };
    await store.createOrganization({ orgId: 'org-a', name: 'Org A', ownerUid: actor.uid });

    const app = await store.saveAppDraft(actor, {
      appId: 'crm-app',
      definition: {
        schemaVersion: 1,
        name: 'Deal Tracker',
        description: 'Internal CRM',
        fields: [{ key: 'status', label: 'Status', type: 'select', required: true, options: ['Lead', 'Won'] }],
        components: [{ id: 'page-main', type: 'page', label: 'Main' }],
        rootPageIds: ['page-main'],
        roleBindings: [],
        statusTransitions: [],
      },
    });

    // Expired approval
    const expired = await store.issueApproval(actor, {
      action: 'publish_app',
      canonicalPayload: { appId: app.id, expectedVersion: 1 },
      ttlSeconds: -5,
    });
    await expect(
      store.publishApp(actor, {
        appId: app.id,
        expectedVersion: 1,
        approvalId: expired.id,
        requestMac: expired.requestMac,
      })
    ).rejects.toThrow(ApprovalVerificationError);

    // Valid approval with altered request parameter (expectedVersion altered or tampered MAC)
    const valid = await store.issueApproval(actor, {
      action: 'publish_app',
      canonicalPayload: { appId: app.id, expectedVersion: 1 },
      ttlSeconds: 300,
    });
    await expect(
      store.publishApp(actor, {
        appId: app.id,
        expectedVersion: 1,
        approvalId: valid.id,
        requestMac: valid.requestMac.replace(/^./, valid.requestMac[0] === 'a' ? 'b' : 'a'),
      })
    ).rejects.toThrow(ApprovalVerificationError);

    // Consume valid approval once -> succeeds
    const published = await store.publishApp(actor, {
      appId: app.id,
      expectedVersion: 1,
      approvalId: valid.id,
      requestMac: valid.requestMac,
    });
    expect(published.snapshot.version).toBe(1);

    // Replay the same approval -> fails
    await expect(
      store.publishApp(actor, {
        appId: app.id,
        expectedVersion: 2,
        approvalId: valid.id,
        requestMac: valid.requestMac,
      })
    ).rejects.toThrow(ApprovalVerificationError);
  });

  it('8. Two concurrent edits with the same expectedVersion produce one success and one conflict', async () => {
    const { store } = createTestEnvironment();
    const actor: VerifiedActor = { uid: 'alice', orgId: 'org-a', role: 'owner' };
    await store.createOrganization({ orgId: 'org-a', name: 'Org A', ownerUid: actor.uid });

    const doc = await store.createDocument(actor, {
      id: 'concurrent-doc',
      kind: 'file',
      name: 'concurrent.md',
      parentId: null,
      body: 'Initial v1',
      language: 'en',
    });

    const outcomes = await Promise.allSettled([
      store.updateDocument(actor, {
        docId: doc.id,
        expectedVersion: 1,
        body: 'Writer A v2',
      }),
      store.updateDocument(actor, {
        docId: doc.id,
        expectedVersion: 1,
        body: 'Writer B v2',
      }),
    ]);

    const successes = outcomes.filter((o) => o.status === 'fulfilled');
    const conflicts = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === 'rejected'
    );

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.reason).toBeInstanceOf(VersionConflictError);
  });

  it('9. A queue item claimed by a job that is killed mid-run is retried once and produces exactly one output', async () => {
    const { store, automationWorker } = createTestEnvironment();
    const actor: VerifiedActor = { uid: 'alice', orgId: 'org-a', role: 'owner' };
    await store.createOrganization({ orgId: 'org-a', name: 'Org A', ownerUid: actor.uid });

    const outFolder = await store.createDocument(actor, {
      id: 'reports-folder',
      kind: 'folder',
      name: 'reports',
      parentId: null,
      body: '',
      language: 'en',
    });

    const app = await store.saveAppDraft(actor, {
      appId: 'ops-app',
      definition: {
        schemaVersion: 1,
        name: 'Ops App',
        description: '',
        fields: [],
        components: [{ id: 'p1', type: 'page', label: 'Ops' }],
        rootPageIds: ['p1'],
        roleBindings: [],
        statusTransitions: [],
      },
      workflow: {
        schemaVersion: 1,
        name: 'Nightly Digest',
        enabled: true,
        trigger: { type: 'schedule', cron: '0 9 * * *' },
        steps: [
          {
            id: 'step-1',
            type: 'summarize_collection',
            collectionIds: ['default'],
            promptTemplate: 'Summarize daily updates into Markdown.',
            outputFolderId: outFolder.id,
          },
        ],
      },
    });

    const publishApproval = await store.issueApproval(actor, {
      action: 'publish_app',
      canonicalPayload: { appId: app.id, expectedVersion: 1 },
    });
    const { snapshot } = await store.publishApp(actor, {
      appId: app.id,
      expectedVersion: 1,
      approvalId: publishApproval.id,
      requestMac: publishApproval.requestMac,
    });

    const queueItem = await store.enqueueAutomation(actor, {
      id: 'job-item-1',
      appId: app.id,
      snapshotVersion: snapshot.version,
      triggerType: 'schedule',
      payload: { date: '2026-10-18' },
    });

    const t0 = new Date('2026-10-18T10:00:00.000Z');

    // Job 1 claims the item and is killed mid-run before completion
    const firstAttempt = await automationWorker.processNextItem(actor, {
      workerId: 'worker-1',
      leaseDurationMs: 10_000,
      now: t0,
      simulateKillBeforeComplete: true,
    });
    expect(firstAttempt.claimed).toBe(true);
    expect(firstAttempt.completed).toBe(false);
    expect(firstAttempt.item?.attempts).toBe(1);

    // After lease expires, Job 2 retries the item and completes it
    const tAfterLease = new Date('2026-10-18T10:00:15.000Z');
    const secondAttempt = await automationWorker.processNextItem(actor, {
      workerId: 'worker-2',
      leaseDurationMs: 10_000,
      now: tAfterLease,
    });
    expect(secondAttempt.claimed).toBe(true);
    expect(secondAttempt.completed).toBe(true);
    expect(secondAttempt.item?.attempts).toBe(2);

    // A third worker run finds nothing left to claim
    const thirdAttempt = await automationWorker.processNextItem(actor, {
      workerId: 'worker-3',
      now: new Date('2026-10-18T10:01:00.000Z'),
    });
    expect(thirdAttempt.claimed).toBe(false);

    // Verify exactly ONE output file was produced in the output folder
    const filesInOutputFolder = await store.listDocuments(actor, {
      parentId: outFolder.id,
      includeDeleted: false,
    });
    expect(filesInOutputFolder).toHaveLength(1);
    expect(filesInOutputFolder[0]?.id).toBe(`auto-out-${queueItem.id}`);
    expect(filesInOutputFolder[0]?.body).toContain('Nightly Digest');
  });

  it('10. The export zip contains every live file as readable Markdown and no ciphertext', async () => {
    const { store, exportService, dumpRawDoc } = createTestEnvironment();
    const actor: VerifiedActor = { uid: 'alice', orgId: 'org-a', role: 'owner' };
    await store.createOrganization({ orgId: 'org-a', name: 'Org A', ownerUid: actor.uid });

    const folder = await store.createDocument(actor, {
      id: 'folder-test',
      kind: 'folder',
      name: 'test',
      parentId: null,
      body: '',
      language: 'en',
    });

    const liveDoc1 = await store.createDocument(actor, {
      id: 'doc-live-1',
      kind: 'file',
      name: '2026-09-07 19-45-33.md',
      parentId: null,
      body: 'Делай там оцифровку видите то все что-то говорю у меня там что-то происходит вот типа вот какие-то такие штуки типа',
      language: 'ru',
    });

    const liveDoc2 = await store.createDocument(actor, {
      id: 'doc-live-2',
      kind: 'file',
      name: '2026-09-02 12-12-16.md',
      parentId: folder.id,
      body: '# Product Strategy\nYour agents remember, and you own the memory.',
      language: 'en',
    });

    const archivedDoc = await store.createDocument(actor, {
      id: 'doc-archived',
      kind: 'file',
      name: 'obsolete.md',
      parentId: null,
      body: 'Archived content that should not be in live export',
      language: 'en',
    });
    const archiveApproval = await store.issueApproval(actor, {
      action: 'archive_document',
      canonicalPayload: { docId: archivedDoc.id, expectedVersion: 1 },
    });
    await store.archiveDocument(actor, {
      docId: archivedDoc.id,
      expectedVersion: 1,
      approvalId: archiveApproval.id,
      requestMac: archiveApproval.requestMac,
    });

    const rawCiphertext1 = dumpRawDoc(`organizations/org-a/documents/${liveDoc1.id}`)
      ?.bodyCiphertext as string;
    const rawCiphertext2 = dumpRawDoc(`organizations/org-a/documents/${liveDoc2.id}`)
      ?.bodyCiphertext as string;

    const exported = await exportService.exportOrganizationZip(actor);

    // ZIP magic bytes: PK\x03\x04
    expect(exported.zipBuffer.subarray(0, 2).toString('utf8')).toBe('PK');
    expect(exported. files['vault/2026-09-07 19-45-33.md']).toBe(liveDoc1.body);
    expect(exported.files['vault/test/2026-09-02 12-12-16.md']).toBe(liveDoc2.body);
    expect(exported.files['vault/obsolete.md']).toBeUndefined();

    // Ensure no ciphertext exists anywhere in the exported files
    const allExportedContent = Object.values(exported.files).join('\n');
    expect(allExportedContent).not.toContain(rawCiphertext1);
    expect(allExportedContent).not.toContain(rawCiphertext2);
    expect(allExportedContent).not.toContain('bodyCiphertext');
  });
});

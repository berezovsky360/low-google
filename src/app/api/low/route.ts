import { NextResponse, type NextRequest } from 'next/server';
import { runRebuildDerivedForOrg } from '../../../../scripts/rebuild-derived';
import { VerifiedActorSchema, type VerifiedActor } from '../../../domain/schemas';
import { getServerContainer } from '../../../server/container';

function resolveActorFromRequest(req: NextRequest): VerifiedActor {
  const uid = req.headers.get('x-low-uid') ?? 'berezovsky360';
  const orgId = req.headers.get('x-low-org-id') ?? 'org-berezovsky';
  const role = (req.headers.get('x-low-role') ?? 'owner') as
    | 'owner'
    | 'admin'
    | 'member';

  return VerifiedActorSchema.parse({
    uid,
    orgId,
    role,
  });
}

export async function GET(req: NextRequest) {
  try {
    const actor = resolveActorFromRequest(req);
    const container = getServerContainer();
    await container.ensureSeeded();

    const { store, dumpRawDoc } = container;
    const [
      organization,
      members,
      documents,
      collections,
      chunks,
      apps,
      queueItems,
      auditEvents,
    ] = await Promise.all([
      store.getOrganization(actor),
      store.listMembers(actor),
      store.listDocuments(actor, { includeDeleted: true }),
      store.listKnowledgeCollections(actor),
      store.listChunks(actor),
      store.listApps(actor),
      store.listQueueItems(actor),
      store.listAuditEvents(actor, { limit: 60 }),
    ]);

    const appRecordsMap: Record<string, unknown[]> = {};
    for (const app of apps) {
      appRecordsMap[app.id] = await store.listAppRecords(actor, app.id, false);
    }

    const rawCiphertexts: Record<string, string> = {};
    for (const doc of documents) {
      if (doc.kind === 'file') {
        const raw = dumpRawDoc(
          `organizations/${actor.orgId}/documents/${doc.id}`
        );
        if (raw && typeof raw.bodyCiphertext === 'string') {
          rawCiphertexts[doc.id] = raw.bodyCiphertext;
        }
      }
    }

    return NextResponse.json({
      actor,
      organization,
      members,
      documents,
      rawCiphertexts,
      collections,
      chunkCount: chunks.length,
      apps,
      appRecordsMap,
      queueItems,
      auditEvents,
      models: {
        ...container.modelProvider.getRuntimeConfig(),
        reasoning: container.modelProvider.getRuntimeConfig().modelId,
        transcription: process.env.LOW_TRANSCRIPTION_MODEL ?? 'gemini-2.5-flash',
        embedding: process.env.LOW_EMBEDDING_MODEL ?? 'text-embedding-004',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = resolveActorFromRequest(req);
    const container = getServerContainer();
    await container.ensureSeeded();
    const {
      store,
      modelProvider,
      memoryService,
      captureService,
      builderAgentService,
      automationWorker,
    } = container;

    const payload = (await req.json()) as {
      operation: string;
      data?: Record<string, unknown>;
    };
    const data = payload.data ?? {};

    switch (payload.operation) {
      case 'configure_models': {
        modelProvider.configureRuntime({
          provider: data.provider as
            | 'gemini'
            | 'vertex'
            | 'openai'
            | 'anthropic'
            | undefined,
          modelId: data.modelId ? String(data.modelId) : undefined,
          apiKey: data.apiKey !== undefined ? String(data.apiKey) : undefined,
        });
        return NextResponse.json({
          models: modelProvider.getRuntimeConfig(),
        });
      }
      case 'create_organization': {
        const org = await store.createOrganization({
          orgId: String(data.orgId),
          name: String(data.name),
          ownerUid: actor.uid,
        });
        return NextResponse.json({ organization: org });
      }

      case 'create_document': {
        const doc = await store.createDocument(actor, {
          kind: (data.kind as 'file' | 'folder') ?? 'file',
          name: String(data.name),
          parentId: (data.parentId as string | null) ?? null,
          body: String(data.body ?? ''),
          language: String(data.language ?? 'en'),
        });
        if (doc.kind === 'file') {
          await memoryService.indexDocument(actor, doc);
        }
        return NextResponse.json({ document: doc });
      }

      case 'update_document': {
        const doc = await store.updateDocument(actor, {
          docId: String(data.docId),
          expectedVersion: Number(data.expectedVersion),
          ...(data.name !== undefined ? { name: String(data.name) } : {}),
          ...(data.body !== undefined ? { body: String(data.body) } : {}),
          ...(data.language !== undefined
            ? { language: String(data.language) }
            : {}),
        });
        if (doc.kind === 'file') {
          await memoryService.indexDocument(actor, doc);
        }
        return NextResponse.json({ document: doc });
      }

      case 'move_document': {
        const doc = await store.moveDocument(actor, {
          docId: String(data.docId),
          expectedVersion: Number(data.expectedVersion),
          targetParentId: (data.targetParentId as string | null) ?? null,
        });
        return NextResponse.json({ document: doc });
      }

      case 'archive_document': {
        const docId = String(data.docId);
        const expectedVersion = Number(data.expectedVersion);
        const approval = await store.issueApproval(actor, {
          action: 'archive_document',
          canonicalPayload: { docId, expectedVersion },
        });
        const archived = await store.archiveDocument(actor, {
          docId,
          expectedVersion,
          approvalId: approval.id,
          requestMac: approval.requestMac,
        });
        await memoryService.indexDocument(actor, archived);
        return NextResponse.json({ document: archived, approval });
      }

      case 'restore_document': {
        const restored = await store.restoreDocument(actor, {
          docId: String(data.docId),
          expectedVersion: Number(data.expectedVersion),
        });
        if (restored.kind === 'file') {
          await memoryService.indexDocument(actor, restored);
        }
        return NextResponse.json({ document: restored });
      }

      case 'list_versions': {
        const versions = await store.listDocumentVersions(
          actor,
          String(data.docId)
        );
        return NextResponse.json({ versions });
      }

      case 'capture_audio': {
        const transcriptText = String(
          data.transcriptText ??
            'Voice capture recorded during Hackathon Judge demonstration. Action item: approve Q4 Cloud Run scale-out.'
        );
        const res = await captureService.captureAudioRecording(actor, {
          fileName: String(
            data.fileName ??
              `${new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-')}.wav`
          ),
          audioBytes: Buffer.from(transcriptText, 'utf8'),
          mimeType: 'audio/wav',
          targetFolderId: (data.targetFolderId as string | null) ?? null,
          language: String(data.language ?? 'en'),
        });
        return NextResponse.json(res);
      }

      case 'create_collection': {
        const collection = await store.createKnowledgeCollection(actor, {
          name: String(data.name),
          rootFolderId: String(data.rootFolderId),
        });
        return NextResponse.json({ collection });
      }

      case 'ask_memory': {
        if (data.provider || data.modelId || data.apiKey !== undefined) {
          modelProvider.configureRuntime({
            provider: data.provider as
              | 'gemini'
              | 'vertex'
              | 'openai'
              | 'anthropic'
              | undefined,
            modelId: data.modelId ? String(data.modelId) : undefined,
            apiKey: data.apiKey !== undefined ? String(data.apiKey) : undefined,
          });
        }
        let colIds = (data.collectionIds as string[]) ?? [];
        if (colIds.length === 0) {
          const allCols = await store.listKnowledgeCollections(actor);
          colIds = allCols.map((c) => c.id);
        }
        const answer = await memoryService.askQuestion(actor, {
          question: String(data.question),
          collectionIds: colIds,
        });
        return NextResponse.json({ answer });
      }

      case 'rebuild_derived': {
        const stats = await runRebuildDerivedForOrg({
          actor,
          store,
        });
        return NextResponse.json({ rebuildStats: stats });
      }

      case 'create_app_from_prompt': {
        const prompt = String(data.prompt ?? 'Custom Workspace App');
        const definition = builderAgentService.createDefinitionFromPrompt(prompt);
        const app = await store.saveAppDraft(actor, {
          definition,
        });
        const pubApproval = await store.issueApproval(actor, {
          action: 'publish_app',
          canonicalPayload: { appId: app.id, expectedVersion: app.version },
        });
        const published = await store.publishApp(actor, {
          appId: app.id,
          expectedVersion: app.version,
          approvalId: pubApproval.id,
          requestMac: pubApproval.requestMac,
        });
        const firstStatus =
          definition.fields.find((f) => f.key === 'status')?.options?.[0] ??
          'Draft';
        await store.createAppRecord(actor, {
          appId: published.app.id,
          fields: {
            title: `${definition.name} — Item #1`,
            status: firstStatus,
            amount: 120,
            dueDate: '2026-09-18',
          },
          notesMarkdown: `Created automatically for **${definition.name}**.`,
        });
        return NextResponse.json({ app: published.app });
      }

      case 'propose_builder_diff': {
        const diff = await builderAgentService.proposeAppDiff(actor, {
          appId: String(data.appId),
          userInstruction: String(data.instruction),
        });
        return NextResponse.json({ diff });
      }

      case 'apply_builder_diff': {
        const app = await store.saveAppDraft(actor, {
          appId: String(data.appId),
          expectedVersion: Number(data.expectedVersion),
          definition: data.definition as never,
        });
        return NextResponse.json({ app });
      }

      case 'publish_app': {
        const appId = String(data.appId);
        const expectedVersion = Number(data.expectedVersion);
        const approval = await store.issueApproval(actor, {
          action: 'publish_app',
          canonicalPayload: { appId, expectedVersion },
        });
        const result = await store.publishApp(actor, {
          appId,
          expectedVersion,
          approvalId: approval.id,
          requestMac: approval.requestMac,
        });
        return NextResponse.json(result);
      }

      case 'create_app_record': {
        const record = await store.createAppRecord(actor, {
          appId: String(data.appId),
          fields: (data.fields as Record<string, string | number | null>) ?? {},
          notesMarkdown: String(data.notesMarkdown ?? ''),
        });
        return NextResponse.json({ record });
      }

      case 'transition_record_status': {
        const appId = String(data.appId);
        const recId = String(data.recId);
        const expectedVersion = Number(data.expectedVersion);
        const toStatus = String(data.toStatus);
        const approval = await store.issueApproval(actor, {
          action: 'transition_record_status',
          canonicalPayload: { appId, recId, expectedVersion, toStatus },
        });
        const record = await store.transitionAppRecordStatus(actor, {
          appId,
          recId,
          expectedVersion,
          statusField: String(data.statusField ?? 'status'),
          toStatus,
          approvalId: approval.id,
          requestMac: approval.requestMac,
        });
        return NextResponse.json({ record, approval });
      }

      case 'enqueue_and_run_automation': {
        const appId = String(data.appId);
        const app = await store.getApp(actor, appId);
        const snapshotVersion = app?.publishedSnapshotVersion ?? 1;
        const queued = await store.enqueueAutomation(actor, {
          appId,
          snapshotVersion,
          triggerType:
            (data.triggerType as 'webhook' | 'schedule') ?? 'webhook',
          payload: (data.payload as Record<string, unknown>) ?? {
            triggeredBy: actor.uid,
            timestamp: new Date().toISOString(),
          },
        });
        const processed = await automationWorker.processNextItem(actor, {
          workerId: 'cloud-run-job-live',
        });
        return NextResponse.json({ queued, processed });
      }

      default:
        return NextResponse.json(
          { error: `Unknown operation: ${payload.operation}` },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }
}

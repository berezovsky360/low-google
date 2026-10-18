import { NextResponse, type NextRequest } from 'next/server';
import { VerifiedActorSchema, type VerifiedActor } from '../../../domain/schemas';
import { getServerContainer } from '../../../server/container';

function resolveActor(req: NextRequest): VerifiedActor {
  return VerifiedActorSchema.parse({
    uid: req.headers.get('x-low-uid') ?? 'berezovsky360',
    orgId: req.headers.get('x-low-org-id') ?? 'org-berezovsky',
    role: (req.headers.get('x-low-role') ?? 'owner') as 'owner' | 'admin' | 'member',
  });
}

const TOOLS = [
  {
    name: 'low_ask_memory',
    description:
      'Ask LOW Grounded Vault Memory a question and get an answer with paragraph citations.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Question to search and answer from LOW Vault memory.',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'low_list_documents',
    description: 'List all decrypted Markdown documents and folders in the LOW Vault.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'low_save_memory',
    description:
      'Save a new encrypted Markdown note into the LOW Vault and index it for retrieval.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'File name (e.g. architecture-decision.md)',
        },
        body: {
          type: 'string',
          description: 'Markdown body content to encrypt and index',
        },
      },
      required: ['name', 'body'],
    },
  },
  {
    name: 'low_list_apps',
    description: 'List all LOW No-Code Apps (CRM, Inventory, etc.) and their live records.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'low_create_app_record',
    description: 'Create a new encrypted Markdown record inside a LOW App (e.g. CRM deal or Inventory SKU).',
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'Target App ID (e.g. app-crm-approvals or app-inventory)',
        },
        title: {
          type: 'string',
          description: 'Record title / deal name / SKU',
        },
        status: {
          type: 'string',
          description: 'Status stage (e.g. Draft, In Stock, Low Stock)',
        },
        amount: {
          type: 'number',
          description: 'Numeric value or quantity',
        },
      },
      required: ['appId', 'title'],
    },
  },
  {
    name: 'low_build_app',
    description: 'Create a new LOW No-Code App & Dashboard from a prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'App blueprint prompt (e.g. Customer Support Tracker)',
        },
      },
      required: ['prompt'],
    },
  },
];

export async function POST(req: NextRequest) {
  try {
    const actor = resolveActor(req);
    const container = getServerContainer();
    await container.ensureSeeded();
    const { store, memoryService, builderAgentService } = container;

    const msg = (await req.json()) as {
      id?: string | number | null;
      method?: string;
      params?: Record<string, unknown>;
    };

    if (msg.method === 'initialize') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: msg.id ?? null,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'low-memory-mcp', version: '1.1.0' },
        },
      });
    }

    if (msg.method === 'tools/list') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: msg.id ?? null,
        result: { tools: TOOLS },
      });
    }

    if (msg.method === 'tools/call') {
      const toolName = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments as Record<string, unknown>) ?? {};

      if (toolName === 'low_ask_memory') {
        const collections = await store.listKnowledgeCollections(actor);
        const answer = await memoryService.askQuestion(actor, {
          question: String(args.question ?? ''),
          collectionIds: collections.map((c) => c.id),
        });
        return NextResponse.json({
          jsonrpc: '2.0',
          id: msg.id ?? null,
          result: {
            content: [{ type: 'text', text: JSON.stringify(answer, null, 2) }],
          },
        });
      }

      if (toolName === 'low_list_documents') {
        const docs = await store.listDocuments(actor, { includeDeleted: false });
        return NextResponse.json({
          jsonrpc: '2.0',
          id: msg.id ?? null,
          result: {
            content: [{ type: 'text', text: JSON.stringify(docs, null, 2) }],
          },
        });
      }

      if (toolName === 'low_save_memory') {
        const doc = await store.createDocument(actor, {
          kind: 'file',
          name: String(args.name ?? 'agent-note.md'),
          parentId: 'folder-test',
          body: String(args.body ?? ''),
          language: 'en',
        });
        await memoryService.indexDocument(actor, doc);
        return NextResponse.json({
          jsonrpc: '2.0',
          id: msg.id ?? null,
          result: {
            content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }],
          },
        });
      }

      if (toolName === 'low_list_apps') {
        const apps = await store.listApps(actor);
        const out = [];
        for (const app of apps) {
          const records = await store.listAppRecords(actor, app.id, false);
          out.push({
            id: app.id,
            name: app.draftDefinition.name,
            status: app.status,
            version: app.version,
            records,
          });
        }
        return NextResponse.json({
          jsonrpc: '2.0',
          id: msg.id ?? null,
          result: {
            content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
          },
        });
      }

      if (toolName === 'low_create_app_record') {
        const rec = await store.createAppRecord(actor, {
          appId: String(args.appId ?? 'app-crm-approvals'),
          fields: {
            title: String(args.title ?? 'New Item'),
            status: String(args.status ?? 'Draft'),
            amount: Number(args.amount ?? 0),
            dueDate: new Date().toISOString().slice(0, 10),
          },
          notesMarkdown: '',
        });
        return NextResponse.json({
          jsonrpc: '2.0',
          id: msg.id ?? null,
          result: {
            content: [{ type: 'text', text: JSON.stringify(rec, null, 2) }],
          },
        });
      }

      if (toolName === 'low_build_app') {
        const definition = builderAgentService.createDefinitionFromPrompt(
          String(args.prompt ?? 'Custom Agent App')
        );
        const app = await store.saveAppDraft(actor, { definition });
        return NextResponse.json({
          jsonrpc: '2.0',
          id: msg.id ?? null,
          result: {
            content: [{ type: 'text', text: JSON.stringify(app, null, 2) }],
          },
        });
      }

      return NextResponse.json({
        jsonrpc: '2.0',
        id: msg.id ?? null,
        error: { code: -32601, message: `Unknown tool: ${toolName}` },
      });
    }

    return NextResponse.json({
      jsonrpc: '2.0',
      id: msg.id ?? null,
      result: {},
    });
  } catch (err) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32603, message: (err as Error).message },
    });
  }
}

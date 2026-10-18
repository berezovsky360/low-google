#!/usr/bin/env npx tsx
import * as readline from 'node:readline';
import { getServerContainer } from '../src/server/container';
import type { VerifiedActor } from '../src/domain/schemas';

const DEFAULT_ACTOR: VerifiedActor = {
  uid: process.env.LOW_UID ?? 'berezovsky360',
  orgId: process.env.LOW_ORG_ID ?? 'org-berezovsky',
  role: (process.env.LOW_ROLE as 'owner' | 'admin' | 'member') ?? 'owner',
};

const REMOTE_API_URL = process.env.LOW_API_URL?.replace(/\/$/, '');

async function callLowOperation(
  operation: string,
  data?: Record<string, unknown>
): Promise<unknown> {
  if (REMOTE_API_URL) {
    const res = await fetch(`${REMOTE_API_URL}/api/low`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-low-uid': DEFAULT_ACTOR.uid,
        'x-low-org-id': DEFAULT_ACTOR.orgId,
        'x-low-role': DEFAULT_ACTOR.role,
      },
      body: JSON.stringify({ operation, data }),
    });
    return res.json();
  }

  const container = getServerContainer();
  await container.ensureSeeded();
  const { store, memoryService, builderAgentService } = container;

  if (operation === 'list_documents') {
    return store.listDocuments(DEFAULT_ACTOR, { includeDeleted: false });
  }
  if (operation === 'ask_memory') {
    const collections = await store.listKnowledgeCollections(DEFAULT_ACTOR);
    return memoryService.askQuestion(DEFAULT_ACTOR, {
      question: String(data?.question ?? ''),
      collectionIds: collections.map((c) => c.id),
    });
  }
  if (operation === 'create_document') {
    const doc = await store.createDocument(DEFAULT_ACTOR, {
      kind: 'file',
      name: String(data?.name ?? 'agent-note.md'),
      parentId: (data?.parentId as string | null) ?? 'folder-test',
      body: String(data?.body ?? ''),
      language: 'en',
    });
    await memoryService.indexDocument(DEFAULT_ACTOR, doc);
    return doc;
  }
  if (operation === 'list_apps') {
    const apps = await store.listApps(DEFAULT_ACTOR);
    const result = [];
    for (const app of apps) {
      const records = await store.listAppRecords(DEFAULT_ACTOR, app.id, false);
      result.push({
        id: app.id,
        name: app.draftDefinition.name,
        status: app.status,
        version: app.version,
        records,
      });
    }
    return result;
  }
  if (operation === 'create_app_record') {
    return store.createAppRecord(DEFAULT_ACTOR, {
      appId: String(data?.appId ?? 'app-crm-approvals'),
      fields: (data?.fields as Record<string, string | number | null>) ?? {},
      notesMarkdown: String(data?.notesMarkdown ?? ''),
    });
  }
  if (operation === 'create_app_from_prompt') {
    const definition = builderAgentService.createDefinitionFromPrompt(
      String(data?.prompt ?? 'Custom Agent App')
    );
    return store.saveAppDraft(DEFAULT_ACTOR, { definition });
  }
  throw new Error(`Unsupported operation: ${operation}`);
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

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

function sendResponse(id: string | number | null, result: unknown) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function sendError(id: string | number | null, code: number, message: string) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`
  );
}

rl.on('line', async (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line) as {
      id?: string | number | null;
      method?: string;
      params?: Record<string, unknown>;
    };

    if (msg.method === 'initialize') {
      sendResponse(msg.id ?? null, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'low-memory-mcp', version: '1.1.0' },
      });
      return;
    }

    if (msg.method === 'notifications/initialized') {
      return;
    }

    if (msg.method === 'tools/list') {
      sendResponse(msg.id ?? null, { tools: TOOLS });
      return;
    }

    if (msg.method === 'tools/call') {
      const toolName = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments as Record<string, unknown>) ?? {};

      if (toolName === 'low_ask_memory') {
        const result = await callLowOperation('ask_memory', {
          question: String(args.question ?? ''),
        });
        sendResponse(msg.id ?? null, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
        return;
      }

      if (toolName === 'low_list_documents') {
        const docs = await callLowOperation('list_documents');
        sendResponse(msg.id ?? null, {
          content: [{ type: 'text', text: JSON.stringify(docs, null, 2) }],
        });
        return;
      }

      if (toolName === 'low_save_memory') {
        const doc = await callLowOperation('create_document', {
          name: String(args.name ?? 'note.md'),
          body: String(args.body ?? ''),
        });
        sendResponse(msg.id ?? null, {
          content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }],
        });
        return;
      }

      if (toolName === 'low_list_apps') {
        const apps = await callLowOperation('list_apps');
        sendResponse(msg.id ?? null, {
          content: [{ type: 'text', text: JSON.stringify(apps, null, 2) }],
        });
        return;
      }

      if (toolName === 'low_create_app_record') {
        const rec = await callLowOperation('create_app_record', {
          appId: String(args.appId ?? 'app-crm-approvals'),
          fields: {
            title: String(args.title ?? 'New Item'),
            status: String(args.status ?? 'Draft'),
            amount: Number(args.amount ?? 0),
            dueDate: new Date().toISOString().slice(0, 10),
          },
        });
        sendResponse(msg.id ?? null, {
          content: [{ type: 'text', text: JSON.stringify(rec, null, 2) }],
        });
        return;
      }

      if (toolName === 'low_build_app') {
        const app = await callLowOperation('create_app_from_prompt', {
          prompt: String(args.prompt ?? 'Custom App'),
        });
        sendResponse(msg.id ?? null, {
          content: [{ type: 'text', text: JSON.stringify(app, null, 2) }],
        });
        return;
      }

      sendError(msg.id ?? null, -32601, `Unknown tool: ${toolName}`);
      return;
    }

    if (msg.id !== undefined) {
      sendResponse(msg.id, {});
    }
  } catch (err) {
    sendError(null, -32700, (err as Error).message);
  }
});

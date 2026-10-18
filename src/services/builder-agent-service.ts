import { NotFoundError } from '../domain/errors';
import {
  AppDefinitionSchema,
  BuilderDiffProposalSchema,
  type AppDefinition,
  type BuilderDiffProposal,
  type ComponentNode,
  type VerifiedActor,
} from '../domain/schemas';
import type { DocumentStore } from '../ports/interfaces';

/**
 * Step 4 & 5: Builder Agent & Standard App Blueprints (CRM, Inventory, Approvals, Custom).
 *
 * The Builder Agent has strictly read, validate, and preview capabilities.
 * It generates or updates a closed Zod `AppDefinition` from natural-language
 * instructions without ever executing generated code.
 */
export function buildTemplateDefinition(prompt: string): AppDefinition {
  const lower = prompt.toLowerCase();

  if (lower.includes('inventory') || lower.includes('stock') || lower.includes('warehouse')) {
    return AppDefinitionSchema.parse({
      schemaVersion: 1,
      name: 'Inventory & Stock Manager',
      description: 'Real-time SKU stock levels, reorder kanban, and supplier schedule.',
      fields: [
        { key: 'title', label: 'Item / SKU', type: 'text', required: true },
        {
          key: 'status',
          label: 'Stock Status',
          type: 'select',
          required: true,
          options: ['In Stock', 'Low Stock', 'Reordered', 'Out of Stock'],
        },
        { key: 'amount', label: 'Units on Hand', type: 'number', required: true },
        { key: 'dueDate', label: 'Next Restock', type: 'date', required: false },
      ],
      components: [
        {
          id: 'page-inventory',
          type: 'page',
          label: 'Inventory Dashboard',
          childrenIds: [
            'metric-units',
            'metric-skus',
            'form-sku',
            'kanban-stock',
            'table-inventory',
            'calendar-restock',
          ],
        },
        {
          id: 'metric-units',
          type: 'metric',
          label: 'Total Units in Warehouse',
          fieldKey: 'amount',
          metricOperation: 'sum',
        },
        {
          id: 'metric-skus',
          type: 'metric',
          label: 'Active SKUs',
          fieldKey: 'amount',
          metricOperation: 'count',
        },
        {
          id: 'form-sku',
          type: 'form',
          label: 'Add SKU',
          action: 'create_record',
        },
        {
          id: 'kanban-stock',
          type: 'kanban',
          label: 'Stock Replenishment Board',
          statusField: 'status',
        },
        {
          id: 'table-inventory',
          type: 'table',
          label: 'SKU Ledger',
        },
        {
          id: 'calendar-restock',
          type: 'calendar',
          label: 'Restock Schedule',
          dateField: 'dueDate',
        },
      ],
      rootPageIds: ['page-inventory'],
      roleBindings: [
        { appRole: 'owner', pageIds: ['page-inventory'] },
        { appRole: 'admin', pageIds: ['page-inventory'] },
        { appRole: 'member', pageIds: ['page-inventory'] },
      ],
      statusTransitions: [],
    });
  }

  if (lower.includes('crm') || lower.includes('sales') || lower.includes('deal') || lower.includes('client')) {
    return AppDefinitionSchema.parse({
      schemaVersion: 1,
      name: 'Sales CRM & Pipeline',
      description: 'Customer pipeline, deal metrics, and revenue forecast.',
      fields: [
        { key: 'title', label: 'Account / Deal', type: 'text', required: true },
        {
          key: 'status',
          label: 'Pipeline Stage',
          type: 'select',
          required: true,
          options: ['Lead', 'Qualified', 'Proposal', 'Won'],
        },
        { key: 'amount', label: 'ARR ($)', type: 'number', required: true },
        { key: 'dueDate', label: 'Close Date', type: 'date', required: false },
      ],
      components: [
        {
          id: 'page-crm',
          type: 'page',
          label: 'Sales Pipeline',
          childrenIds: [
            'metric-arr',
            'metric-avg',
            'form-deal',
            'kanban-deals',
            'table-deals',
            'calendar-closes',
          ],
        },
        {
          id: 'metric-arr',
          type: 'metric',
          label: 'Pipeline ARR ($)',
          fieldKey: 'amount',
          metricOperation: 'sum',
        },
        {
          id: 'metric-avg',
          type: 'metric',
          label: 'Avg Deal Size ($)',
          fieldKey: 'amount',
          metricOperation: 'avg',
        },
        {
          id: 'form-deal',
          type: 'form',
          label: 'New Deal',
          action: 'create_record',
        },
        {
          id: 'kanban-deals',
          type: 'kanban',
          label: 'Deal Stage Board',
          statusField: 'status',
        },
        {
          id: 'table-deals',
          type: 'table',
          label: 'All Accounts',
        },
        {
          id: 'calendar-closes',
          type: 'calendar',
          label: 'Expected Closes',
          dateField: 'dueDate',
        },
      ],
      rootPageIds: ['page-crm'],
      roleBindings: [
        { appRole: 'owner', pageIds: ['page-crm'] },
        { appRole: 'admin', pageIds: ['page-crm'] },
        { appRole: 'member', pageIds: ['page-crm'] },
      ],
      statusTransitions: [],
    });
  }

  const customName =
    prompt.trim().length > 0
      ? prompt.trim().slice(0, 48)
      : 'Custom Internal App';

  return AppDefinitionSchema.parse({
    schemaVersion: 1,
    name: customName,
    description: 'Built with LOW Deterministic App Runtime.',
    fields: [
      { key: 'title', label: 'Name', type: 'text', required: true },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        required: true,
        options: ['Todo', 'In Progress', 'Done'],
      },
      { key: 'amount', label: 'Value', type: 'number', required: false },
      { key: 'dueDate', label: 'Date', type: 'date', required: false },
    ],
    components: [
      {
        id: 'page-main',
        type: 'page',
        label: 'Main Dashboard',
        childrenIds: [
          'metric-count',
          'metric-sum',
          'form-main',
          'kanban-main',
          'table-main',
        ],
      },
      {
        id: 'metric-count',
        type: 'metric',
        label: 'Total Items',
        fieldKey: 'amount',
        metricOperation: 'count',
      },
      {
        id: 'metric-sum',
        type: 'metric',
        label: 'Total Value',
        fieldKey: 'amount',
        metricOperation: 'sum',
      },
      {
        id: 'form-main',
        type: 'form',
        label: 'Quick Add',
        action: 'create_record',
      },
      {
        id: 'kanban-main',
        type: 'kanban',
        label: 'Board',
        statusField: 'status',
      },
      {
        id: 'table-main',
        type: 'table',
        label: 'Records Table',
      },
    ],
    rootPageIds: ['page-main'],
    roleBindings: [],
    statusTransitions: [],
  });
}

export class BuilderAgentService {
  public readonly allowedTools = [
    'read_definition',
    'validate_definition',
    'preview_diff',
  ] as const;

  constructor(private readonly store: Pick<DocumentStore, 'getApp'>) {}

  createDefinitionFromPrompt(prompt: string): AppDefinition {
    return buildTemplateDefinition(prompt);
  }

  async proposeAppDiff(
    actor: VerifiedActor,
    params: {
      appId: string;
      userInstruction: string;
    }
  ): Promise<BuilderDiffProposal> {
    const app = await this.store.getApp(actor, params.appId);
    if (!app) {
      throw new NotFoundError(`App ${params.appId} not found in tenant ${actor.orgId}`);
    }

    const currentDef: AppDefinition = structuredClone(app.draftDefinition);
    const instructionLower = params.userInstruction.toLowerCase();

    // If user asks to transform into CRM or Inventory template completely:
    if (
      instructionLower.includes('rebuild as inventory') ||
      instructionLower.includes('switch to inventory') ||
      instructionLower.includes('transform into inventory')
    ) {
      const nextDef = buildTemplateDefinition('inventory');
      return BuilderDiffProposalSchema.parse({
        appId: app.id,
        baseVersion: app.version,
        summary: `Replace layout with Inventory & Stock Manager (${nextDef.components.length} components)`,
        proposedDefinition: nextDef,
        addedComponentIds: nextDef.components.map((c) => c.id),
        modifiedComponentIds: [],
        removedComponentIds: currentDef.components.map((c) => c.id),
      });
    }

    if (
      instructionLower.includes('rebuild as crm') ||
      instructionLower.includes('switch to crm') ||
      instructionLower.includes('transform into sales crm')
    ) {
      const nextDef = buildTemplateDefinition('crm');
      return BuilderDiffProposalSchema.parse({
        appId: app.id,
        baseVersion: app.version,
        summary: `Replace layout with Sales CRM & Pipeline (${nextDef.components.length} components)`,
        proposedDefinition: nextDef,
        addedComponentIds: nextDef.components.map((c) => c.id),
        modifiedComponentIds: [],
        removedComponentIds: currentDef.components.map((c) => c.id),
      });
    }

    const nextDef: AppDefinition = structuredClone(currentDef);
    const addedComponentIds: string[] = [];
    const modifiedComponentIds: string[] = [];
    const removedComponentIds: string[] = [];

    const firstPage = nextDef.components.find((c) => c.type === 'page');
    const appendNode = (node: ComponentNode) => {
      nextDef.components.push(node);
      if (firstPage) {
        firstPage.childrenIds = [...(firstPage.childrenIds ?? []), node.id];
        if (!modifiedComponentIds.includes(firstPage.id)) {
          modifiedComponentIds.push(firstPage.id);
        }
      }
      addedComponentIds.push(node.id);
    };

    if (instructionLower.includes('table')) {
      appendNode({
        id: `comp-table-${nextDef.components.length + 1}`,
        type: 'table',
        label: 'Records Table',
      });
    }
    if (instructionLower.includes('kanban') || instructionLower.includes('board')) {
      appendNode({
        id: `comp-kanban-${nextDef.components.length + 1}`,
        type: 'kanban',
        label: 'Status Board',
        statusField: 'status',
      });
    }
    if (instructionLower.includes('calendar') || instructionLower.includes('schedule')) {
      appendNode({
        id: `comp-calendar-${nextDef.components.length + 1}`,
        type: 'calendar',
        label: 'Schedule Calendar',
        dateField: 'dueDate',
      });
    }
    if (instructionLower.includes('form') || instructionLower.includes('input')) {
      appendNode({
        id: `comp-form-${nextDef.components.length + 1}`,
        type: 'form',
        label: 'New Record Form',
        action: 'create_record',
      });
    }
    if (
      instructionLower.includes('metric') ||
      instructionLower.includes('kpi') ||
      instructionLower.includes('average') ||
      instructionLower.includes('avg')
    ) {
      appendNode({
        id: `comp-metric-${nextDef.components.length + 1}`,
        type: 'metric',
        label: instructionLower.includes('avg') ? 'Average Value' : 'Total Value',
        fieldKey: 'amount',
        metricOperation: instructionLower.includes('avg') ? 'avg' : 'sum',
      });
    }
    if (instructionLower.includes('markdown') || instructionLower.includes('banner')) {
      appendNode({
        id: `comp-md-${nextDef.components.length + 1}`,
        type: 'markdown_block',
        label: 'Note Block',
        markdown: `**Note:** ${params.userInstruction}`,
      });
    }
    if (addedComponentIds.length === 0) {
      appendNode({
        id: `comp-chat-${nextDef.components.length + 1}`,
        type: 'agent_chat',
        label: 'Memory Assistant',
      });
    }

    const validatedProposed = AppDefinitionSchema.parse(nextDef);

    return BuilderDiffProposalSchema.parse({
      appId: app.id,
      baseVersion: app.version,
      summary: `+${addedComponentIds.length} component(s) (${addedComponentIds.join(', ')})`,
      proposedDefinition: validatedProposed,
      addedComponentIds,
      modifiedComponentIds,
      removedComponentIds,
    });
  }
}

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
 * Step 5: Builder Agent.
 *
 * The Builder Agent has strictly read, validate, and preview capabilities.
 * It NEVER writes to the store, publishes an app, or selects a tenant.
 * Applying a proposed diff requires an explicit user call to `saveAppDraft`.
 */
export class BuilderAgentService {
  public readonly allowedTools = ['read_definition', 'validate_definition', 'preview_diff'] as const;

  constructor(private readonly store: Pick<DocumentStore, 'getApp'>) {}

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
    const nextDef: AppDefinition = structuredClone(currentDef);
    const instructionLower = params.userInstruction.toLowerCase();

    const addedComponentIds: string[] = [];
    const modifiedComponentIds: string[] = [];
    const removedComponentIds: string[] = [];

    if (instructionLower.includes('kanban') && !nextDef.components.some((c) => c.type === 'kanban')) {
      const id = `comp-kanban-${nextDef.components.length + 1}`;
      const kanbanNode: ComponentNode = {
        id,
        type: 'kanban',
        label: 'Pipeline Kanban Board',
        statusField: 'status',
      };
      nextDef.components.push(kanbanNode);
      const firstPage = nextDef.components.find((c) => c.type === 'page');
      if (firstPage) {
        firstPage.childrenIds = [...(firstPage.childrenIds ?? []), id];
        modifiedComponentIds.push(firstPage.id);
      }
      addedComponentIds.push(id);
    } else if (instructionLower.includes('calendar') && !nextDef.components.some((c) => c.type === 'calendar')) {
      const id = `comp-calendar-${nextDef.components.length + 1}`;
      const calNode: ComponentNode = {
        id,
        type: 'calendar',
        label: 'Schedule Calendar',
        dateField: 'dueDate',
      };
      nextDef.components.push(calNode);
      const firstPage = nextDef.components.find((c) => c.type === 'page');
      if (firstPage) {
        firstPage.childrenIds = [...(firstPage.childrenIds ?? []), id];
        modifiedComponentIds.push(firstPage.id);
      }
      addedComponentIds.push(id);
    } else if (instructionLower.includes('metric') || instructionLower.includes('kpi')) {
      const id = `comp-metric-${nextDef.components.length + 1}`;
      const metricNode: ComponentNode = {
        id,
        type: 'metric',
        label: 'Total Deal Value',
        fieldKey: 'amount',
        metricOperation: 'sum',
      };
      nextDef.components.push(metricNode);
      const firstPage = nextDef.components.find((c) => c.type === 'page');
      if (firstPage) {
        firstPage.childrenIds = [...(firstPage.childrenIds ?? []), id];
        modifiedComponentIds.push(firstPage.id);
      }
      addedComponentIds.push(id);
    } else {
      const id = `comp-agent-chat-${nextDef.components.length + 1}`;
      const chatNode: ComponentNode = {
        id,
        type: 'agent_chat',
        label: `Grounded Copilot (${params.userInstruction.slice(0, 36)})`,
      };
      nextDef.components.push(chatNode);
      const firstPage = nextDef.components.find((c) => c.type === 'page');
      if (firstPage) {
        firstPage.childrenIds = [...(firstPage.childrenIds ?? []), id];
        modifiedComponentIds.push(firstPage.id);
      }
      addedComponentIds.push(id);
    }

    // Validate strictly with closed AppDefinitionSchema before returning preview
    const validatedProposed = AppDefinitionSchema.parse(nextDef);

    return BuilderDiffProposalSchema.parse({
      appId: app.id,
      baseVersion: app.version,
      summary: `Proposed validated diff for "${params.userInstruction}": +${addedComponentIds.length} component(s), ~${modifiedComponentIds.length} updated.`,
      proposedDefinition: validatedProposed,
      addedComponentIds,
      modifiedComponentIds,
      removedComponentIds,
    });
  }
}

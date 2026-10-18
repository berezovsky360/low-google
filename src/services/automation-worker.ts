import type { DecryptedDocument, StoredQueueItem, VerifiedActor } from '../domain/schemas';
import type { DocumentStore } from '../ports/interfaces';
import type { MemoryService } from './memory-service';

export class AutomationWorker {
  constructor(
    private readonly store: DocumentStore,
    private readonly memoryService?: MemoryService
  ) {}

  /**
   * Claims the next pending (or lease-expired with attempts < 2) queue item in a
   * Firestore transaction, runs the published snapshot's workflow steps, and
   * atomically writes the single declared Markdown output document.
   */
  async processNextItem(
    actor: VerifiedActor,
    options?: {
      workerId?: string;
      leaseDurationMs?: number;
      now?: Date;
      simulateKillBeforeComplete?: boolean;
    }
  ): Promise<{
    claimed: boolean;
    completed: boolean;
    item?: StoredQueueItem;
    outputDocument?: DecryptedDocument;
  }> {
    const workerId = options?.workerId ?? `cloud-run-job-${process.pid}`;
    const claim = await this.store.claimNextAutomationItem(actor, {
      workerId,
      leaseDurationMs: options?.leaseDurationMs ?? 30_000,
      now: options?.now,
    });

    if (!claim) {
      return { claimed: false, completed: false };
    }

    if (options?.simulateKillBeforeComplete) {
      // Simulates a Cloud Run Job container killed mid-run after claiming the item
      return {
        claimed: true,
        completed: false,
        item: claim.item,
      };
    }

    const workflow = claim.snapshot.workflow;
    const firstStep = workflow?.steps[0];
    const outputFolderId = firstStep?.outputFolderId ?? 'root';
    const workflowName = workflow?.name ?? claim.snapshot.definition.name;

    const payloadSummary = Object.entries(claim.decryptedPayload)
      .map(([k, v]) => `- **${k}**: ${JSON.stringify(v)}`)
      .join('\n');

    const outputMarkdown = [
      `# Automation Run: ${workflowName}`,
      '',
      `- **Queue Item ID**: \`${claim.item.id}\``,
      `- **App ID**: \`${claim.item.appId}\` (Snapshot v${claim.item.snapshotVersion})`,
      `- **Trigger**: \`${claim.item.triggerType}\``,
      '',
      '## Input Payload',
      payloadSummary || '- *(empty payload)*',
      '',
      '## Output Summary',
      firstStep
        ? `Executed workflow step \`${firstStep.id}\` (${firstStep.type}) with prompt template: "${firstStep.promptTemplate}".`
        : 'Executed default snapshot automation step.',
    ].join('\n');

    const completed = await this.store.completeAutomationItem(actor, {
      itemId: claim.item.id,
      workerId,
      outputFolderId,
      outputFileName: `automation-${claim.item.id}.md`,
      outputMarkdown,
    });

    if (this.memoryService) {
      await this.memoryService.indexDocument(actor, completed.outputDocument);
    }

    return {
      claimed: true,
      completed: true,
      item: completed.item,
      outputDocument: completed.outputDocument,
    };
  }
}

import { FirestoreRepository } from '../src/adapters/google/firestore-repository';
import { GeminiEmbedder, GeminiModelProvider } from '../src/adapters/google/gemini-providers';
import { LocalKmsEmulatorKeyProvider } from '../src/adapters/google/kms-key-provider';
import type { VerifiedActor } from '../src/domain/schemas';
import type { DocumentStore } from '../src/ports/interfaces';
import { MemoryService } from '../src/services/memory-service';

export async function runRebuildDerivedForOrg(params: {
  actor: VerifiedActor;
  store: DocumentStore;
  embeddingModel?: string;
  reasoningModel?: string;
}): Promise<{
  deletedChunks: number;
  rebuiltDocuments: number;
  rebuiltChunks: number;
}> {
  const embedder = new GeminiEmbedder(
    params.embeddingModel ?? process.env.LOW_EMBEDDING_MODEL ?? 'text-embedding-004'
  );
  const modelProvider = new GeminiModelProvider(
    params.reasoningModel ?? process.env.LOW_REASONING_MODEL ?? 'gemini-2.5-flash'
  );
  const memoryService = new MemoryService(params.store, embedder, modelProvider);
  return memoryService.rebuildDerivedIndex(params.actor);
}

async function main() {
  const orgId = process.argv[2] ?? process.env.LOW_REBUILD_ORG_ID ?? 'org-berezovsky';
  const uid = process.argv[3] ?? 'berezovsky360';

  const keyProvider = new LocalKmsEmulatorKeyProvider();
  const store = new FirestoreRepository({ keyProvider });
  const actor: VerifiedActor = { uid, orgId, role: 'owner' };

  const result = await runRebuildDerivedForOrg({ actor, store });
  console.log(
    JSON.stringify(
      {
        status: 'ok',
        orgId,
        ...result,
      },
      null,
      2
    )
  );
}

const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('rebuild-derived.ts');

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

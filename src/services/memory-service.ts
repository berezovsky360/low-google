import {
  MemoryAnswerSchema,
  type Chunk,
  type DecryptedDocument,
  type MemoryAnswer,
  type VerifiedActor,
} from '../domain/schemas';
import type { DocumentStore, Embedder, ModelProvider } from '../ports/interfaces';
import { sha256Hex } from '../security/crypto';

/**
 * Deterministic Markdown paragraph chunker.
 * Splits Markdown into paragraph blocks so each chunk has a 0-indexed `ordinal`
 * that can be cited as `docId §ordinal`.
 */
export function chunkMarkdownIntoParagraphs(markdown: string): string[] {
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const rawBlocks = normalized
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const merged: string[] = [];
  let pendingHeading = '';

  for (const block of rawBlocks) {
    if (/^#{1,6}\s+[^\n]+$/.test(block)) {
      pendingHeading = pendingHeading ? `${pendingHeading}\n${block}` : block;
    } else if (pendingHeading) {
      merged.push(`${pendingHeading}\n${block}`);
      pendingHeading = '';
    } else {
      merged.push(block);
    }
  }

  if (pendingHeading) {
    merged.push(pendingHeading);
  }

  return merged;
}

export class MemoryService {
  constructor(
    private readonly store: DocumentStore,
    private readonly embedder: Embedder,
    private readonly modelProvider: ModelProvider
  ) {}

  async indexDocument(
    actor: VerifiedActor,
    doc: DecryptedDocument
  ): Promise<Chunk[]> {
    if (doc.kind !== 'file' || doc.deletedAt !== null) {
      return this.store.replaceDocumentChunks(actor, doc.id, []);
    }

    const paragraphs = chunkMarkdownIntoParagraphs(doc.body);
    if (paragraphs.length === 0) {
      return this.store.replaceDocumentChunks(actor, doc.id, []);
    }

    const { vectors } = await this.embedder.embedBatch(paragraphs);
    const chunkInputs = paragraphs.map((text, ordinal) => ({
      ordinal,
      text,
      embedding: vectors[ordinal] ?? [],
      sha256: sha256Hex(text),
    }));

    return this.store.replaceDocumentChunks(actor, doc.id, chunkInputs);
  }

  /**
   * Principle 1: Deletes all derived chunks and embeddings for the organization
   * and rebuilds them purely from the decrypted Markdown documents.
   */
  async rebuildDerivedIndex(actor: VerifiedActor): Promise<{
    deletedChunks: number;
    rebuiltDocuments: number;
    rebuiltChunks: number;
  }> {
    const deletedChunks = await this.store.deleteAllDerivedChunks(actor);
    const liveDocs = await this.store.listDocuments(actor, {
      includeDeleted: false,
    });

    const files = liveDocs
      .filter((d) => d.kind === 'file')
      .sort((a, b) => a.id.localeCompare(b.id));

    let rebuiltChunks = 0;
    for (const file of files) {
      const created = await this.indexDocument(actor, file);
      rebuiltChunks += created.length;
    }

    return {
      deletedChunks,
      rebuiltDocuments: files.length,
      rebuiltChunks,
    };
  }

  async askQuestion(
    actor: VerifiedActor,
    params: {
      question: string;
      collectionIds: string[];
      topK?: number;
    }
  ): Promise<MemoryAnswer> {
    const startMs = Date.now();
    const { vector: queryVector } = await this.embedder.embedText(params.question);

    const searchHits = await this.store.searchVectorChunks(actor, {
      collectionIds: params.collectionIds,
      queryVector,
      topK: params.topK ?? 5,
    });

    const grounded = await this.modelProvider.generateGroundedAnswer({
      question: params.question,
      chunks: searchHits.map((hit) => ({
        docId: hit.chunk.docId,
        documentName: hit.documentName,
        ordinal: hit.chunk.ordinal,
        text: hit.chunk.text,
      })),
    });

    const latencyMs = Math.max(1, Date.now() - startMs);

    await this.store.recordRun(actor, {
      status: 'succeeded',
      model: grounded.model,
      tokens: grounded.tokensUsed,
      cost: Number((grounded.tokensUsed * 0.000001).toFixed(6)),
      latency: latencyMs,
      error: null,
    });

    const hitMap = new Map(
      searchHits.map((h) => [`${h.chunk.docId}:${h.chunk.ordinal}`, h])
    );

    const citations = grounded.citations.map((c) => {
      const hit = hitMap.get(`${c.docId}:${c.paragraphOrdinal}`);
      return {
        docId: c.docId,
        documentName: hit?.documentName ?? c.docId,
        paragraphOrdinal: c.paragraphOrdinal,
        excerpt: hit?.chunk.text ?? '',
        score: Number((hit?.score ?? 0).toFixed(4)),
      };
    });

    return MemoryAnswerSchema.parse({
      question: params.question,
      answerMarkdown: grounded.answerMarkdown,
      notFound: grounded.notFound,
      citations,
      model: grounded.model,
      latencyMs,
    });
  }
}

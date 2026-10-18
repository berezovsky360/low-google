import type { DecryptedDocument, VerifiedActor } from '../domain/schemas';
import type { DocumentStore, ObjectStore, Transcriber } from '../ports/interfaces';
import type { MemoryService } from './memory-service';

export class CaptureService {
  constructor(
    private readonly store: DocumentStore,
    private readonly objectStore: ObjectStore,
    private readonly transcriber: Transcriber,
    private readonly memoryService?: MemoryService
  ) {}

  async captureAudioRecording(
    actor: VerifiedActor,
    params: {
      fileName: string;
      audioBytes: Buffer;
      mimeType: string;
      targetFolderId: string | null;
      language?: string;
    }
  ): Promise<{
    document: DecryptedDocument;
    storageUri: string;
    transcribedModel: string;
  }> {
    const cleanBaseName = params.fileName.replace(/\.[^.]+$/, '');
    const mdFileName = `${cleanBaseName}.md`;

    const storedObj = await this.objectStore.putObject({
      orgId: actor.orgId,
      path: `recordings/${Date.now()}-${params.fileName}`,
      data: params.audioBytes,
      contentType: params.mimeType,
    });

    const transcription = await this.transcriber.transcribeAudio({
      audioBytes: params.audioBytes,
      mimeType: params.mimeType,
      languageHint: params.language,
    });

    await this.store.recordRun(actor, {
      status: 'succeeded',
      model: transcription.model,
      tokens: transcription.tokensUsed,
      cost: Number((transcription.tokensUsed * 0.000001).toFixed(6)),
      latency: 45,
      error: null,
    });

    const doc = await this.store.createDocument(actor, {
      kind: 'file',
      name: mdFileName,
      parentId: params.targetFolderId,
      body: transcription.markdown,
      language: params.language ?? 'en',
    });

    if (this.memoryService) {
      await this.memoryService.indexDocument(actor, doc);
    }

    return {
      document: doc,
      storageUri: storedObj.uri,
      transcribedModel: transcription.model,
    };
  }

  async captureDocumentUpload(
    actor: VerifiedActor,
    params: {
      fileName: string;
      fileBytes: Buffer;
      mimeType: string;
      targetFolderId: string | null;
      language?: string;
    }
  ): Promise<{ document: DecryptedDocument; storageUri: string }> {
    const storedObj = await this.objectStore.putObject({
      orgId: actor.orgId,
      path: `uploads/${Date.now()}-${params.fileName}`,
      data: params.fileBytes,
      contentType: params.mimeType,
    });

    const rawText = params.fileBytes.toString('utf8').trim();
    const cleanBaseName = params.fileName.replace(/\.[^.]+$/, '');
    const mdFileName = params.fileName.endsWith('.md')
      ? params.fileName
      : `${cleanBaseName}.md`;

    const markdownBody = params.fileName.endsWith('.md')
      ? rawText
      : `# ${cleanBaseName}\n\n${rawText}`;

    const doc = await this.store.createDocument(actor, {
      kind: 'file',
      name: mdFileName,
      parentId: params.targetFolderId,
      body: markdownBody,
      language: params.language ?? 'en',
    });

    if (this.memoryService) {
      await this.memoryService.indexDocument(actor, doc);
    }

    return {
      document: doc,
      storageUri: storedObj.uri,
    };
  }
}

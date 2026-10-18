import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import { TenantIsolationError } from '../domain/errors';
import type { DecryptedDocument, VerifiedActor } from '../domain/schemas';
import type { DocumentStore } from '../ports/interfaces';

export interface ExportArchiveResult {
  zipBuffer: Buffer;
  files: Record<string, string>;
}

/**
 * Principle 7 & Step 8: Organization Export Service.
 * Exports the entire organization as a portable .zip archive containing:
 * - Every live Markdown document in its folder path (`vault/.../*.md`)
 * - Every live App record as decrypted Markdown (`apps/{appId}/records/{recId}.md`)
 * - Every App & Workflow definition as clean JSON (`apps/{appId}/definition.json`)
 * - Organization & Knowledge Collection manifest (`manifest.json`)
 *
 * Never exports ciphertext.
 */
export class ExportService {
  constructor(private readonly store: DocumentStore) {}

  private buildDocumentPath(
    doc: DecryptedDocument,
    folderMap: Map<string, DecryptedDocument>
  ): string {
    const segments: string[] = [];
    for (const ancId of doc.ancestors) {
      const folder = folderMap.get(ancId);
      if (folder) {
        segments.push(folder.name);
      }
    }
    const fileName = doc.name.endsWith('.md') ? doc.name : `${doc.name}.md`;
    segments.push(fileName);
    return `vault/${segments.join('/')}`;
  }

  async exportOrganizationZip(actor: VerifiedActor): Promise<ExportArchiveResult> {
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      throw new TenantIsolationError('Only organization owners or admins can export the organization');
    }

    const [org, docs, collections, apps] = await Promise.all([
      this.store.getOrganization(actor),
      this.store.listDocuments(actor, { includeDeleted: false }),
      this.store.listKnowledgeCollections(actor),
      this.store.listApps(actor),
    ]);

    const folderMap = new Map<string, DecryptedDocument>();
    for (const d of docs) {
      if (d.kind === 'folder') {
        folderMap.set(d.id, d);
      }
    }

    const files: Record<string, string> = {};

    for (const d of docs) {
      if (d.kind === 'file') {
        const relPath = this.buildDocumentPath(d, folderMap);
        files[relPath] = d.body;
      }
    }

    for (const app of apps) {
      files[`apps/${app.id}/definition.json`] = JSON.stringify(
        {
          id: app.id,
          version: app.version,
          status: app.status,
          publishedSnapshotVersion: app.publishedSnapshotVersion,
          definition: app.draftDefinition,
          workflow: app.draftWorkflow,
        },
        null,
        2
      );

      const records = await this.store.listAppRecords(actor, app.id, false);
      for (const rec of records) {
        files[`apps/${app.id}/records/${rec.id}.md`] = rec.body;
      }
    }

    files['manifest.json'] = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        organization: org,
        collections,
        liveDocumentCount: docs.filter((d) => d.kind === 'file').length,
        appCount: apps.length,
      },
      null,
      2
    );

    files['docker-compose.self-host.yml'] = [
      'services:',
      '  low-self-hosted:',
      '    image: ghcr.io/berezovsky360/low-google:latest',
      '    ports:',
      '      - "3000:8080"',
      '    environment:',
      '      - NODE_ENV=production',
      '      - PORT=8080',
      '      - LOW_IMPORT_ARCHIVE=/data',
      '    volumes:',
      '      - ./:/data:ro',
      '',
    ].join('\n');

    files['SELF_HOST.md'] = [
      `# ${org?.name ?? actor.orgId} — Portable LOW Workspace & Apps`,
      '',
      '## Quick Start (Self-Hosted)',
      '```bash',
      'docker compose -f docker-compose.self-host.yml up -d',
      '```',
      '',
      '## Contents',
      '- `vault/` — Decrypted Markdown source-of-truth files',
      '- `apps/*/definition.json` — Strict schema-validated No-Code App & Workflow definitions',
      '- `apps/*/records/*.md` — Decrypted Markdown records with YAML frontmatter',
      '',
    ].join('\n');

    const zipBuffer = await this.packToZipBuffer(files);
    return { zipBuffer, files };
  }

  private packToZipBuffer(files: Record<string, string>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];
      const stream = new PassThrough();

      stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
      archive.on('error', reject);

      archive.pipe(stream);

      for (const [filePath, content] of Object.entries(files)) {
        archive.append(Buffer.from(content, 'utf8'), { name: filePath });
      }

      void archive.finalize();
    });
  }
}

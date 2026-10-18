import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FirestoreRepository } from '../src/adapters/google/firestore-repository';
import { LocalKmsEmulatorKeyProvider } from '../src/adapters/google/kms-key-provider';
import {
  ApprovalVerificationError,
  CiphertextIntegrityError,
  VersionConflictError,
} from '../src/domain/errors';
import { AppDefinitionSchema, type VerifiedActor } from '../src/domain/schemas';
import { createInMemoryFirestore } from './helpers/in-memory-firestore';

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      files.push(full);
    }
  }
  return files;
}

describe('Step 1 Backend Foundation & Non-Negotiable Principles', () => {
  it('enforces Principle 2: only src/adapters/google/firestore-repository.ts may import firebase-admin/firestore', () => {
    const srcRoot = join(process.cwd(), 'src');
    const files = collectSourceFiles(srcRoot);
    const allowedFile = 'src/adapters/google/firestore-repository.ts';

    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(process.cwd(), file).replace(/\\/g, '/');
      const content = readFileSync(file, 'utf8');
      if (
        content.includes('firebase-admin/firestore') &&
        rel !== allowedFile
      ) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('enforces Principle 2 & 5 in firestore.rules: tenant orgId match and append-only audit log', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8');
    expect(rules).toContain('request.auth.token.orgId == orgId');
    expect(rules).toContain('match /audit/{eventId}');
    expect(rules).toContain('allow update, delete: if false;');
  });

  it('enforces tenant isolation: Organization A member cannot read, list, or mutate Organization B documents', async () => {
    const { db } = createInMemoryFirestore();
    const keyProvider = new LocalKmsEmulatorKeyProvider();
    const repo = new FirestoreRepository({ db, keyProvider });

    const actorA: VerifiedActor = { uid: 'user-a', orgId: 'org-alpha', role: 'owner' };
    const actorB: VerifiedActor = { uid: 'user-b', orgId: 'org-beta', role: 'owner' };

    await repo.createOrganization({
      orgId: 'org-alpha',
      name: 'Alpha Corp',
      ownerUid: actorA.uid,
    });
    await repo.createOrganization({
      orgId: 'org-beta',
      name: 'Beta LLC',
      ownerUid: actorB.uid,
    });

    const docB = await repo.createDocument(actorB, {
      id: 'secret-roadmap',
      kind: 'file',
      name: '2026-roadmap.md',
      parentId: null,
      body: '# Confidential Beta Roadmap\nLaunch Q4.',
      language: 'en',
    });

    // Actor A cannot read or list Actor B's document
    const readByA = await repo.getDocument(actorA, docB.id);
    expect(readByA).toBeNull();

    const listByA = await repo.listDocuments(actorA);
    expect(listByA).toHaveLength(0);

    // Actor A cannot update Actor B's document
    await expect(
      repo.updateDocument(actorA, {
        docId: docB.id,
        expectedVersion: 1,
        body: 'Hacked',
      })
    ).rejects.toThrow(/not found/i);
  });

  it('enforces Principle 6: body in Firestore is ciphertext, decrypts for owner, and fails AAD check if copied across tenants or documents', async () => {
    const { db, dumpRawDoc, setRawDoc } = createInMemoryFirestore();
    const keyProvider = new LocalKmsEmulatorKeyProvider();
    const repo = new FirestoreRepository({ db, keyProvider });

    const actorA: VerifiedActor = { uid: 'user-a', orgId: 'org-alpha', role: 'owner' };
    const actorB: VerifiedActor = { uid: 'user-b', orgId: 'org-beta', role: 'owner' };

    await repo.createOrganization({
      orgId: 'org-alpha',
      name: 'Alpha Corp',
      ownerUid: actorA.uid,
    });
    await repo.createOrganization({
      orgId: 'org-beta',
      name: 'Beta LLC',
      ownerUid: actorB.uid,
    });

    const markdownText = '# Quarterly Review\nRevenue grew 42% YoY.';
    const created = await repo.createDocument(actorA, {
      id: 'q1-review',
      kind: 'file',
      name: 'q1-review.md',
      parentId: null,
      body: markdownText,
      language: 'en',
    });

    // 1. Read straight from Firestore: bodyCiphertext is encrypted, never plaintext
    const rawInFirestore = dumpRawDoc('organizations/org-alpha/documents/q1-review');
    expect(rawInFirestore).toBeDefined();
    expect(rawInFirestore?.bodyCiphertext).toBeTypeOf('string');
    expect(rawInFirestore?.bodyCiphertext).not.toContain('Quarterly Review');
    expect(rawInFirestore?.body).toBeUndefined();

    // 2. Read through repository by owner: returns original Markdown
    const decrypted = await repo.getDocument(actorA, created.id);
    expect(decrypted?.body).toBe(markdownText);

    // 3. Copy ciphertext into Organization B's document with the same docId -> fails to decrypt
    await repo.createDocument(actorB, {
      id: 'q1-review',
      kind: 'file',
      name: 'q1-review.md',
      parentId: null,
      body: 'Placeholder',
      language: 'en',
    });

    const rawB = dumpRawDoc('organizations/org-beta/documents/q1-review')!;
    setRawDoc('organizations/org-beta/documents/q1-review', {
      ...rawB,
      bodyCiphertext: rawInFirestore!.bodyCiphertext,
    });

    await expect(repo.getDocument(actorB, 'q1-review')).rejects.toThrow(
      CiphertextIntegrityError
    );

    // 4. Even within the SAME organization, copying ciphertext to a different docId fails AAD check
    await repo.createDocument(actorA, {
      id: 'other-doc',
      kind: 'file',
      name: 'other-doc.md',
      parentId: null,
      body: 'Initial',
      language: 'en',
    });
    const rawOtherA = dumpRawDoc('organizations/org-alpha/documents/other-doc')!;
    setRawDoc('organizations/org-alpha/documents/other-doc', {
      ...rawOtherA,
      bodyCiphertext: rawInFirestore!.bodyCiphertext,
    });

    await expect(repo.getDocument(actorA, 'other-doc')).rejects.toThrow(
      CiphertextIntegrityError
    );
  });

  it('enforces optimistic concurrency: two concurrent edits with the same expectedVersion produce one success and one conflict', async () => {
    const { db } = createInMemoryFirestore();
    const keyProvider = new LocalKmsEmulatorKeyProvider();
    const repo = new FirestoreRepository({ db, keyProvider });

    const actor: VerifiedActor = { uid: 'user-a', orgId: 'org-alpha', role: 'owner' };
    await repo.createOrganization({
      orgId: 'org-alpha',
      name: 'Alpha Corp',
      ownerUid: actor.uid,
    });

    const doc = await repo.createDocument(actor, {
      id: 'notes',
      kind: 'file',
      name: 'notes.md',
      parentId: null,
      body: 'v1 content',
      language: 'en',
    });

    const results = await Promise.allSettled([
      repo.updateDocument(actor, {
        docId: doc.id,
        expectedVersion: 1,
        body: 'v2 from writer 1',
      }),
      repo.updateDocument(actor, {
        docId: doc.id,
        expectedVersion: 1,
        body: 'v2 from writer 2',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected'
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(VersionConflictError);

    const versions = await repo.listDocumentVersions(actor, doc.id);
    expect(versions).toHaveLength(2);
    expect(versions[0]?.version).toBe(2);
    expect(versions[1]?.version).toBe(1);
  });

  it('enforces Principle 4: replayed, altered, and expired approvals all fail', async () => {
    const { db } = createInMemoryFirestore();
    const keyProvider = new LocalKmsEmulatorKeyProvider();
    const repo = new FirestoreRepository({ db, keyProvider });

    const actor: VerifiedActor = { uid: 'user-a', orgId: 'org-alpha', role: 'owner' };
    await repo.createOrganization({
      orgId: 'org-alpha',
      name: 'Alpha Corp',
      ownerUid: actor.uid,
    });

    const doc = await repo.createDocument(actor, {
      id: 'archive-target',
      kind: 'file',
      name: 'archive-target.md',
      parentId: null,
      body: 'To be archived',
      language: 'en',
    });

    // 1. Expired approval fails
    const expiredApproval = await repo.issueApproval(actor, {
      action: 'archive_document',
      canonicalPayload: { docId: doc.id, expectedVersion: 1 },
      ttlSeconds: -10,
    });

    await expect(
      repo.archiveDocument(actor, {
        docId: doc.id,
        expectedVersion: 1,
        approvalId: expiredApproval.id,
        requestMac: expiredApproval.requestMac,
      })
    ).rejects.toThrow(ApprovalVerificationError);

    // 2. Altered approval (approved for doc.id, used with tampered MAC or different version) fails
    const validApproval = await repo.issueApproval(actor, {
      action: 'archive_document',
      canonicalPayload: { docId: doc.id, expectedVersion: 1 },
      ttlSeconds: 300,
    });

    await expect(
      repo.archiveDocument(actor, {
        docId: doc.id,
        expectedVersion: 1,
        approvalId: validApproval.id,
        requestMac: '0'.repeat(64),
      })
    ).rejects.toThrow(ApprovalVerificationError);

    // 3. Valid approval succeeds once and records audit event
    const archived = await repo.archiveDocument(actor, {
      docId: doc.id,
      expectedVersion: 1,
      approvalId: validApproval.id,
      requestMac: validApproval.requestMac,
    });
    expect(archived.deletedAt).not.toBeNull();
    expect(archived.version).toBe(2);

    // Restore doc so we can attempt replay
    const restored = await repo.restoreDocument(actor, {
      docId: doc.id,
      expectedVersion: 2,
    });
    expect(restored.deletedAt).toBeNull();

    // 4. Replaying the already-used approval fails
    await expect(
      repo.archiveDocument(actor, {
        docId: doc.id,
        expectedVersion: 3,
        approvalId: validApproval.id,
        requestMac: validApproval.requestMac,
      })
    ).rejects.toThrow(ApprovalVerificationError);

    const audits = await repo.listAuditEvents(actor);
    expect(audits.length).toBeGreaterThanOrEqual(5);
  });

  it('enforces Principle 3: AppDefinitionSchema rejects unknown component types and extra properties naming the field', () => {
    const unknownComponentResult = AppDefinitionSchema.safeParse({
      schemaVersion: 1,
      name: 'CRM',
      fields: [],
      components: [
        {
          id: 'c1',
          type: 'custom_script_widget',
        },
      ],
      rootPageIds: ['c1'],
    });
    expect(unknownComponentResult.success).toBe(false);
    if (!unknownComponentResult.success) {
      const formatted = JSON.stringify(unknownComponentResult.error.issues);
      expect(formatted).toContain('type');
    }

    const extraPropertyResult = AppDefinitionSchema.safeParse({
      schemaVersion: 1,
      name: 'CRM',
      fields: [],
      components: [
        {
          id: 'page-1',
          type: 'page',
          onClickEval: 'alert(1)',
        },
      ],
      rootPageIds: ['page-1'],
    });
    expect(extraPropertyResult.success).toBe(false);
    if (!extraPropertyResult.success) {
      const formatted = JSON.stringify(extraPropertyResult.error.issues);
      expect(formatted).toContain('onClickEval');
    }
  });
});

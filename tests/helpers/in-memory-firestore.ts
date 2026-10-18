import type { Firestore, Transaction } from 'firebase-admin/firestore';

type DocData = Record<string, unknown>;

/**
 * Minimal, strongly-consistent in-memory Firestore double that implements
 * `collection().doc()`, nested subcollections, and serialized atomic
 * `runTransaction()` so `FirestoreRepository` can be tested deterministically
 * alongside Firebase Emulator Suite runs.
 */
export function createInMemoryFirestore(): {
  db: Firestore;
  dumpRawDoc: (path: string) => DocData | undefined;
  setRawDoc: (path: string, data: DocData) => void;
} {
  const store = new Map<string, DocData>();
  let txChain: Promise<unknown> = Promise.resolve();

  function normalizePath(path: string): string {
    return path.replace(/^\/+|\/+$/g, '');
  }

  function makeDocRef(path: string) {
    const cleanPath = normalizePath(path);
    const segments = cleanPath.split('/');
    const id = segments[segments.length - 1] ?? '';

    return {
      id,
      path: cleanPath,
      collection(subName: string) {
        return makeCollectionRef(`${cleanPath}/${subName}`);
      },
      async get() {
        const raw = store.get(cleanPath);
        return {
          id,
          exists: raw !== undefined,
          data: () => (raw ? structuredClone(raw) : undefined),
        };
      },
      async set(data: DocData) {
        store.set(cleanPath, structuredClone(data));
      },
      async create(data: DocData) {
        if (store.has(cleanPath)) {
          throw new Error(`Document already exists at ${cleanPath}`);
        }
        store.set(cleanPath, structuredClone(data));
      },
      async update(patch: DocData) {
        const cur = store.get(cleanPath);
        if (!cur) {
          throw new Error(`No document to update at ${cleanPath}`);
        }
        store.set(cleanPath, { ...structuredClone(cur), ...structuredClone(patch) });
      },
    };
  }

  function makeCollectionRef(path: string) {
    const cleanColPath = normalizePath(path);
    const colDepth = cleanColPath.split('/').length;

    return {
      path: cleanColPath,
      doc(docId: string) {
        return makeDocRef(`${cleanColPath}/${docId}`);
      },
      async get() {
        const docs: Array<{ id: string; exists: boolean; data: () => DocData }> = [];
        for (const [k, v] of store.entries()) {
          if (k.startsWith(`${cleanColPath}/`)) {
            const parts = k.split('/');
            if (parts.length === colDepth + 1) {
              const id = parts[parts.length - 1] ?? '';
              const cloned = structuredClone(v);
              docs.push({
                id,
                exists: true,
                data: () => structuredClone(cloned),
              });
            }
          }
        }
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
  }

  const db = {
    collection(name: string) {
      return makeCollectionRef(name);
    },
    async runTransaction<T>(updateFunction: (tx: Transaction) => Promise<T>): Promise<T> {
      const execute = async (): Promise<T> => {
        const snapshotBefore = new Map<string, DocData>();
        for (const [k, v] of store.entries()) {
          snapshotBefore.set(k, structuredClone(v));
        }

        const stagedWrites: Array<() => void> = [];

        const tx = {
          async get(ref: { path: string }) {
            const p = normalizePath(ref.path);
            const raw = store.get(p);
            const id = p.split('/').pop() ?? '';
            return {
              id,
              exists: raw !== undefined,
              data: () => (raw ? structuredClone(raw) : undefined),
            };
          },
          create(ref: { path: string }, data: DocData) {
            const p = normalizePath(ref.path);
            stagedWrites.push(() => {
              if (store.has(p)) {
                throw new Error(`Document already exists at ${p}`);
              }
              store.set(p, structuredClone(data));
            });
            return tx;
          },
          set(ref: { path: string }, data: DocData) {
            const p = normalizePath(ref.path);
            stagedWrites.push(() => {
              store.set(p, structuredClone(data));
            });
            return tx;
          },
          update(ref: { path: string }, patch: DocData) {
            const p = normalizePath(ref.path);
            stagedWrites.push(() => {
              const cur = store.get(p);
              if (!cur) {
                throw new Error(`Document does not exist at ${p}`);
              }
              store.set(p, {
                ...structuredClone(cur),
                ...structuredClone(patch),
              });
            });
            return tx;
          },
        } as unknown as Transaction;

        try {
          const result = await updateFunction(tx);
          for (const writeOp of stagedWrites) {
            writeOp();
          }
          return result;
        } catch (err) {
          store.clear();
          for (const [k, v] of snapshotBefore.entries()) {
            store.set(k, v);
          }
          throw err;
        }
      };

      const next = txChain.then(execute, execute);
      txChain = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
  } as unknown as Firestore;

  return {
    db,
    dumpRawDoc(path: string) {
      const val = store.get(normalizePath(path));
      return val ? structuredClone(val) : undefined;
    },
    setRawDoc(path: string, data: DocData) {
      store.set(normalizePath(path), structuredClone(data));
    },
  };
}

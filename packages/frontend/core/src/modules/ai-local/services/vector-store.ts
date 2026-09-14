import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

export interface VectorChunk {
  /** `${docId}:${chunkIndex}` */
  id: string;
  docId: string;
  chunkIndex: number;
  text: string;
  /** unit-normalized embedding */
  embedding: number[];
  /** doc version this chunk was embedded from (for incremental updates) */
  version: number;
}

export interface VectorSearchResult {
  docId: string;
  chunkIndex: number;
  text: string;
  score: number;
}

interface VectorDB extends DBSchema {
  chunks: {
    key: string;
    value: VectorChunk;
    indexes: { 'by-doc': string };
  };
  docMeta: {
    key: string;
    value: { docId: string; version: number; chunks: number };
  };
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Local, per-workspace vector index over doc chunks (IndexedDB via `idb`).
 * Search is brute-force cosine — fine up to tens of thousands of chunks; the
 * interface lets us swap in an ANN index later without touching callers.
 * Local-only (never synced): embeddings are large + derived.
 */
export class VectorStore {
  private dbPromise: Promise<IDBPDatabase<VectorDB>> | null = null;

  constructor(private readonly workspaceId: string) {}

  private db(): Promise<IDBPDatabase<VectorDB>> {
    this.dbPromise ??= openDB<VectorDB>(
      `notesgraph-ai-vec:${this.workspaceId}`,
      1,
      {
        upgrade(db) {
          const chunks = db.createObjectStore('chunks', { keyPath: 'id' });
          chunks.createIndex('by-doc', 'docId');
          db.createObjectStore('docMeta', { keyPath: 'docId' });
        },
      }
    );
    return this.dbPromise;
  }

  /** Version a doc was last embedded at, or undefined if never. */
  async getDocVersion(docId: string): Promise<number | undefined> {
    const db = await this.db();
    return (await db.get('docMeta', docId))?.version;
  }

  /** Replace all chunks for a doc with a freshly embedded set. */
  async upsertDoc(
    docId: string,
    version: number,
    chunks: { text: string; embedding: number[] }[]
  ): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['chunks', 'docMeta'], 'readwrite');
    const store = tx.objectStore('chunks');
    let cursor = await store
      .index('by-doc')
      .openCursor(IDBKeyRange.only(docId));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    for (let i = 0; i < chunks.length; i++) {
      await store.put({
        id: `${docId}:${i}`,
        docId,
        chunkIndex: i,
        text: chunks[i].text,
        embedding: chunks[i].embedding,
        version,
      });
    }
    await tx.objectStore('docMeta').put({
      docId,
      version,
      chunks: chunks.length,
    });
    await tx.done;
  }

  async removeDoc(docId: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['chunks', 'docMeta'], 'readwrite');
    const store = tx.objectStore('chunks');
    let cursor = await store
      .index('by-doc')
      .openCursor(IDBKeyRange.only(docId));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.objectStore('docMeta').delete(docId);
    await tx.done;
  }

  /** Doc ids that currently have embeddings (to prune deleted docs). */
  async embeddedDocIds(): Promise<string[]> {
    const db = await this.db();
    return db.getAllKeys('docMeta') as Promise<string[]>;
  }

  /** All stored chunks for a doc (used to find related docs). */
  async getDocChunks(docId: string): Promise<VectorChunk[]> {
    const db = await this.db();
    return db.getAllFromIndex('chunks', 'by-doc', docId);
  }

  /** Top-k chunks by cosine similarity to the query vector. */
  async search(
    queryEmbedding: number[],
    topK = 5
  ): Promise<VectorSearchResult[]> {
    const db = await this.db();
    const all = await db.getAll('chunks');
    const scored = all.map(chunk => ({
      docId: chunk.docId,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      score: dot(queryEmbedding, chunk.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async stats(): Promise<{ docs: number; chunks: number }> {
    const db = await this.db();
    return {
      docs: await db.count('docMeta'),
      chunks: await db.count('chunks'),
    };
  }
}

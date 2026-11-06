import { beforeEach, expect, test } from 'vitest';

import { bindNativeDBApis, type NativeDBApis } from '../impls/sqlite/db';
import { SqliteIndexerStorage } from '../impls/sqlite/indexer';

/** An in-memory stand-in for the native index, counting field reads. */
let index: Map<string, Map<string, string>>;
let reads: number;

beforeEach(() => {
  index = new Map();
  reads = 0;
  const table = (name: string) => {
    let t = index.get(name);
    if (!t) index.set(name, (t = new Map()));
    return t;
  };
  bindNativeDBApis({
    ftsAddDocument: async (
      _id: string,
      name: string,
      docId: string,
      text: string
    ) => {
      table(name).set(docId, text);
    },
    ftsDeleteDocument: async (_id: string, name: string, docId: string) => {
      table(name).delete(docId);
    },
    ftsSearch: async (_id: string, name: string, query: string) =>
      [...table(name)]
        .filter(([, text]) => query === '*' || text.includes(query))
        .map(([id]) => ({ id, score: 1, terms: [] })),
    ftsGetDocument: async (_id: string, name: string, docId: string) => {
      reads++;
      return table(name).get(docId) ?? null;
    },
  } as unknown as NativeDBApis);
});

// Connections are shared by id, so a test that binds its own native stub
// must use a fresh id to get a connection bound to it.
const storage = (id = 'ws') =>
  new SqliteIndexerStorage({ flavour: 'local', type: 'workspace', id });

const block = (id: string, content: string) => ({
  id,
  fields: new Map([
    ['docId', ['doc']],
    ['blockId', [id]],
    ['content', [content]],
  ]),
});

const search = (s: SqliteIndexerStorage) =>
  s.search(
    'block',
    { type: 'exists', field: 'blockId' },
    { fields: ['blockId', 'content'], pagination: { limit: 100 } }
  );

test('a rerun of a query reads only what was written since', async () => {
  const s = storage();
  await s.insert('block', block('a', 'one') as any);
  await s.insert('block', block('b', 'two') as any);

  await search(s);
  expect(reads).toBe(4);

  // Nothing changed: nothing is read again.
  await search(s);
  expect(reads).toBe(4);

  // One block changed: only its fields are read, and the new text shows.
  await s.insert('block', block('b', 'three') as any);
  const result = await search(s);
  expect(reads).toBe(6);
  // Fields come back as arrays, as the phone's index gives them.
  expect(result.nodes.map(node => node.fields.content)).toEqual([
    ['one'],
    ['three'],
  ]);
});

test('a deleted block is not served from what was read before', async () => {
  const s = storage();
  await s.insert('block', block('a', 'one') as any);
  await search(s);
  await s.delete('block', 'a');
  expect((await search(s)).nodes).toEqual([]);
});

test('a search reads stored fields in one batched native call per field', async () => {
  let batches = 0;
  const batchedReads: string[][] = [];
  const base = index;
  bindNativeDBApis({
    ftsAddDocument: async (
      _id: string,
      name: string,
      docId: string,
      text: string
    ) => {
      let t = base.get(name);
      if (!t) base.set(name, (t = new Map()));
      t.set(docId, text);
    },
    ftsDeleteDocument: async () => {},
    ftsSearch: async (_id: string, name: string) =>
      [...(base.get(name) ?? [])].map(([id]) => ({ id, score: 1, terms: [] })),
    ftsGetDocument: async (_id: string, name: string, docId: string) => {
      reads++;
      return base.get(name)?.get(docId) ?? null;
    },
    ftsGetDocuments: async (_id: string, name: string, docIds: string[]) => {
      batches++;
      batchedReads.push(docIds);
      return docIds.map(docId => base.get(name)?.get(docId) ?? null);
    },
  } as unknown as NativeDBApis);

  const s = storage('ws-batched');
  await s.insert('block', block('a', 'one') as any);
  await s.insert('block', block('b', 'two') as any);
  await s.insert('block', block('c', 'three') as any);

  const result = await search(s);
  expect(result.nodes.map(node => node.fields.content)).toEqual([
    ['one'],
    ['two'],
    ['three'],
  ]);
  // Two fields requested: one batch each, no per-id reads at all.
  expect(batches).toBe(2);
  expect(batchedReads.map(ids => ids.length)).toEqual([3, 3]);
  expect(reads).toBe(0);

  // A rerun is served from the cache.
  await search(s);
  expect(batches).toBe(2);
  expect(reads).toBe(0);
});

test('a native side without the batched read falls back to per-id reads', async () => {
  // The default stub in beforeEach has no ftsGetDocuments.
  const s = storage();
  await s.insert('block', block('a', 'one') as any);
  const result = await search(s);
  expect(result.nodes.map(node => node.fields.content)).toEqual([['one']]);
  expect(reads).toBe(2);
});

test('an aggregate reads the bucket field in batches', async () => {
  let batches = 0;
  const base = index;
  bindNativeDBApis({
    ftsAddDocument: async (
      _id: string,
      name: string,
      docId: string,
      text: string
    ) => {
      let t = base.get(name);
      if (!t) base.set(name, (t = new Map()));
      t.set(docId, text);
    },
    ftsDeleteDocument: async () => {},
    ftsSearch: async (_id: string, name: string) =>
      [...(base.get(name) ?? [])].map(([id]) => ({ id, score: 1, terms: [] })),
    ftsGetDocument: async (_id: string, name: string, docId: string) => {
      reads++;
      return base.get(name)?.get(docId) ?? null;
    },
    ftsGetDocuments: async (_id: string, name: string, docIds: string[]) => {
      batches++;
      return docIds.map(docId => base.get(name)?.get(docId) ?? null);
    },
  } as unknown as NativeDBApis);

  const s = storage('ws-aggregate');
  await s.insert('block', block('a', 'one') as any);
  await s.insert('block', block('b', 'two') as any);
  const result = await s.aggregate(
    'block',
    { type: 'exists', field: 'blockId' },
    'docId'
  );
  expect(result.buckets.map(b => [b.key, b.count])).toEqual([['doc', 2]]);
  expect(batches).toBe(1);
  expect(reads).toBe(0);
});

test('a write to another document during a batched read keeps the batch', async () => {
  const base = index;
  let batches = 0;
  let overlapPending = true;
  let s: SqliteIndexerStorage | null = null;
  bindNativeDBApis({
    ftsAddDocument: async (
      _id: string,
      name: string,
      docId: string,
      text: string
    ) => {
      let t = base.get(name);
      if (!t) base.set(name, (t = new Map()));
      t.set(docId, text);
    },
    ftsDeleteDocument: async () => {},
    ftsSearch: async (_id: string, name: string) =>
      [...(base.get(name) ?? [])].map(([id]) => ({ id, score: 1, terms: [] })),
    ftsGetDocument: async (_id: string, name: string, docId: string) => {
      reads++;
      return base.get(name)?.get(docId) ?? null;
    },
    ftsGetDocuments: async (_id: string, name: string, docIds: string[]) => {
      batches++;
      const texts = docIds.map(docId => base.get(name)?.get(docId) ?? null);
      // While the very first batch is in flight, writes land on a different
      // document ('c') and on 'b' itself.
      if (overlapPending && s) {
        overlapPending = false;
        await s.insert('block', block('c', 'three') as any);
        await s.insert('block', block('b', 'two!') as any);
      }
      return texts;
    },
  } as unknown as NativeDBApis);

  s = storage('ws-overlap');
  await s.insert('block', block('a', 'one') as any);
  await s.insert('block', block('b', 'two') as any);
  await search(s);

  reads = 0;
  batches = 0;
  const result = await search(s);
  // 'a' was kept from the overlapped batch; 'b' (written meanwhile) and 'c'
  // (new) are read again, in one batch per field, with no per-id reads.
  expect(result.nodes.map(node => node.fields.content)).toEqual([
    ['one'],
    ['two!'],
    ['three'],
  ]);
  expect(reads).toBe(0);
  expect(batches).toBe(2);
});

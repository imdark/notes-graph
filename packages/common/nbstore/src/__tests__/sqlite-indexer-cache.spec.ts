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

const storage = () =>
  new SqliteIndexerStorage({ flavour: 'local', type: 'workspace', id: 'ws' });

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

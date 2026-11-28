import 'fake-indexeddb/auto';

import { expect, test } from 'vitest';

import { IndexedDBIndexerStorage } from '../impls/idb';
import { IndexerDocument, type Query } from '../storage';

let counter = 0;
async function openIndexer() {
  const indexer = new IndexedDBIndexerStorage({
    id: `write-${counter++}`,
    flavour: 'test',
    type: 'workspace',
  });
  indexer.connection.connect();
  await indexer.connection.waitForConnected();
  return indexer;
}

const block = (docId: string, blockId: string, content: string) =>
  IndexerDocument.from<'block'>(`${docId}:${blockId}`, {
    docId,
    blockId,
    content,
    flavour: 'notesgraph:paragraph',
  }) as IndexerDocument;

const ofDoc = (docId: string): Query<'block'> => ({
  type: 'match',
  field: 'docId',
  match: docId,
});

/** What the sync does to index a note: drop its blocks, insert them all. */
async function reindex(
  indexer: IndexedDBIndexerStorage,
  docId: string,
  contents: Record<string, string>
) {
  await indexer.deleteByQuery('block', ofDoc(docId));
  for (const [blockId, content] of Object.entries(contents)) {
    await indexer.insert('block', block(docId, blockId, content));
  }
  await indexer.refresh('block');
}

/** Every stored record's key by its id: a rewritten record gets a new key. */
async function recordKeys(indexer: IndexedDBIndexerStorage) {
  const { db } = indexer.connection.inner;
  const store = db.transaction('indexerRecords').objectStore('indexerRecords');
  const keys = await store.getAllKeys();
  const out: Record<string, number> = {};
  for (const key of keys) out[(await store.get(key))!.id] = key;
  return out;
}

const indexRows = (indexer: IndexedDBIndexerStorage) =>
  indexer.connection.inner.db.count('invertedIndex');

const fullTextCount = async (indexer: IndexedDBIndexerStorage) =>
  (
    await indexer.connection.inner.db.get(
      'indexerMetadata',
      'full-text:field-count:block:content'
    )
  )?.value;

const found = async (indexer: IndexedDBIndexerStorage, word: string) =>
  (
    await indexer.search('block', {
      type: 'match',
      field: 'content',
      match: word,
    })
  ).nodes
    .map(node => node.id)
    .sort();

/** Count the update signals a write sends the live queries. */
function updates(indexer: IndexedDBIndexerStorage) {
  const seen = { count: 0 };
  const original = indexer.emitTableUpdated.bind(indexer);
  indexer.emitTableUpdated = table => {
    seen.count++;
    original(table);
  };
  return seen;
}

test('re-indexing a note that has not changed writes nothing', async () => {
  const indexer = await openIndexer();
  const note = { a: 'alpha beta', b: 'gamma delta', c: 'epsilon' };
  await reindex(indexer, 'doc', note);
  const keys = await recordKeys(indexer);
  const rows = await indexRows(indexer);
  const signals = updates(indexer);

  await reindex(indexer, 'doc', note);

  expect(await recordKeys(indexer)).toEqual(keys);
  expect(await indexRows(indexer)).toBe(rows);
  // The full-text totals are not counted a second time.
  expect(await fullTextCount(indexer)).toBe(3);
  // And the live queries are not told to run again.
  expect(signals.count).toBe(0);

  indexer.connection.disconnect();
});

test('editing one block rewrites that block only', async () => {
  const indexer = await openIndexer();
  await reindex(indexer, 'doc', { a: 'alpha', b: 'gamma', c: 'epsilon' });
  const before = await recordKeys(indexer);
  const signals = updates(indexer);

  await reindex(indexer, 'doc', { a: 'alpha', b: 'omega', c: 'epsilon' });

  const after = await recordKeys(indexer);
  expect(after['doc:a']).toBe(before['doc:a']);
  expect(after['doc:c']).toBe(before['doc:c']);
  expect(after['doc:b']).not.toBe(before['doc:b']);
  expect(await found(indexer, 'omega')).toEqual(['doc:b']);
  expect(await found(indexer, 'gamma')).toEqual([]);
  expect(await found(indexer, 'alpha')).toEqual(['doc:a']);
  expect(signals.count).toBe(1);

  indexer.connection.disconnect();
});

test('a block removed from the note is removed from the index', async () => {
  const indexer = await openIndexer();
  await reindex(indexer, 'doc', { a: 'alpha', b: 'gamma' });
  await reindex(indexer, 'other', { a: 'alpha' });

  await reindex(indexer, 'doc', { a: 'alpha' });

  expect(Object.keys(await recordKeys(indexer)).sort()).toEqual([
    'doc:a',
    'other:a',
  ]);
  expect(await found(indexer, 'gamma')).toEqual([]);
  // The other note's block with the same text is untouched.
  expect(await found(indexer, 'alpha')).toEqual(['doc:a', 'other:a']);

  indexer.connection.disconnect();
});

test('a large note is indexed whole, and searchable', async () => {
  const indexer = await openIndexer();
  const note: Record<string, string> = {};
  for (let i = 0; i < 300; i++) note[`b${i}`] = `word${i} shared text`;

  await reindex(indexer, 'big', note);

  expect(Object.keys(await recordKeys(indexer))).toHaveLength(300);
  // Full-text matching is fuzzy (word124 shares most of word123), so the
  // exact block is the best hit rather than the only one.
  const best = await indexer.search('block', {
    type: 'match',
    field: 'content',
    match: 'word123',
  });
  expect(best.nodes[0].id).toBe('big:b123');
  expect(
    (await indexer.search('block', ofDoc('big'), { pagination: { limit: 1 } }))
      .pagination.count
  ).toBe(300);
  expect(await fullTextCount(indexer)).toBe(300);

  indexer.connection.disconnect();
});

test('inserting an id twice in one batch keeps the later one', async () => {
  const indexer = await openIndexer();
  await reindex(indexer, 'doc', { a: 'stored' });

  // The later one equals what is stored; the earlier one must not win.
  await indexer.insert('block', block('doc', 'a', 'interim'));
  await indexer.insert('block', block('doc', 'a', 'stored'));
  await indexer.refresh('block');
  expect(await found(indexer, 'stored')).toEqual(['doc:a']);
  expect(await found(indexer, 'interim')).toEqual([]);

  await indexer.insert('block', block('doc', 'a', 'first'));
  await indexer.insert('block', block('doc', 'a', 'second'));
  await indexer.refresh('block');
  expect(await found(indexer, 'second')).toEqual(['doc:a']);
  expect(await found(indexer, 'first')).toEqual([]);
  expect(Object.keys(await recordKeys(indexer))).toEqual(['doc:a']);

  indexer.connection.disconnect();
});

test('deleting an id and inserting it again in one batch keeps it', async () => {
  const indexer = await openIndexer();
  await reindex(indexer, 'doc', { a: 'alpha' });

  await indexer.delete('block', 'doc:a');
  await indexer.insert('block', block('doc', 'a', 'alpha'));
  await indexer.refresh('block');

  expect(await found(indexer, 'alpha')).toEqual(['doc:a']);

  indexer.connection.disconnect();
});

test('an update that changes nothing is not written', async () => {
  const indexer = await openIndexer();
  await indexer.insert(
    'doc',
    IndexerDocument.from<'doc'>('doc', {
      docId: 'doc',
      title: 'Title',
      summary: 'a summary',
    }) as IndexerDocument
  );
  await indexer.refresh('doc');
  const before = await recordKeys(indexer);
  const signals = updates(indexer);

  const same = IndexerDocument.from<'doc'>('doc', { summary: 'a summary' });
  await indexer.update('doc', same as IndexerDocument);
  await indexer.refresh('doc');
  expect(await recordKeys(indexer)).toEqual(before);
  expect(signals.count).toBe(0);

  const changed = IndexerDocument.from<'doc'>('doc', { summary: 'another' });
  await indexer.update('doc', changed as IndexerDocument);
  await indexer.refresh('doc');
  expect(signals.count).toBe(1);
  const stored = await indexer.search(
    'doc',
    { type: 'match', field: 'docId', match: 'doc' },
    { fields: ['summary', 'title'] }
  );
  expect(stored.nodes[0].fields).toEqual({
    summary: 'another',
    title: 'Title',
  });

  indexer.connection.disconnect();
});

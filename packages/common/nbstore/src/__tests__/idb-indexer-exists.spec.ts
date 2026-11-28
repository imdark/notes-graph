import 'fake-indexeddb/auto';

import { afterEach, expect, test, vi } from 'vitest';

import { IndexedDBIndexerStorage } from '../impls/idb';
import { StringInvertedIndex } from '../impls/idb/indexer/inverted-index';
import { IndexerDocument, type Query } from '../storage';

let counter = 0;
async function openIndexer() {
  const indexer = new IndexedDBIndexerStorage({
    id: `exists-${counter++}`,
    flavour: 'test',
    type: 'workspace',
  });
  indexer.connection.connect();
  await indexer.connection.waitForConnected();
  return indexer;
}

const block = (docId: string, blockId: string, refDocId?: string) =>
  IndexerDocument.from<'block'>(`${docId}:${blockId}`, {
    docId,
    blockId,
    content: `text of ${blockId}`,
    ...(refDocId ? { refDocId } : {}),
  }) as IndexerDocument;

/** The app's "links from this note" query: DocsSearchService.watchRefsFrom. */
const refsFrom = (docId: string): Query<'block'> => ({
  type: 'boolean',
  occur: 'must',
  queries: [
    {
      type: 'boolean',
      occur: 'should',
      queries: [{ type: 'match', field: 'docId', match: docId }],
    },
    { type: 'exists', field: 'refDocId' },
  ],
});

const linked = async (indexer: IndexedDBIndexerStorage, docId: string) =>
  (
    await indexer.search('block', refsFrom(docId), { fields: ['refDocId'] })
  ).nodes
    .map(node => node.id)
    .sort();

afterEach(() => {
  vi.restoreAllMocks();
});

test('many link queries share one scan of the links', async () => {
  const indexer = await openIndexer();
  for (let d = 0; d < 20; d++) {
    await indexer.insert('block', block(`doc${d}`, 'a', `doc${d + 1}`));
    await indexer.insert('block', block(`doc${d}`, 'b'));
  }
  await indexer.refresh('block');

  const scans = vi.spyOn(StringInvertedIndex.prototype, 'all');
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, d) => linked(indexer, `doc${d}`))
  );

  // Each note's one linking block, and not its block without a link.
  expect(results).toEqual(Array.from({ length: 20 }, (_, d) => [`doc${d}:a`]));
  // Before: one scan of every link in the workspace per query, 20 here.
  expect(scans).toHaveBeenCalledTimes(1);

  indexer.connection.disconnect();
});

test('a write is seen by the next query', async () => {
  const indexer = await openIndexer();
  await indexer.insert('block', block('doc', 'a', 'other'));
  await indexer.refresh('block');
  expect(await linked(indexer, 'doc')).toEqual(['doc:a']);

  // A new link, and the old one gone.
  await indexer.insert('block', block('doc', 'b', 'third'));
  await indexer.delete('block', 'doc:a');
  await indexer.refresh('block');
  expect(await linked(indexer, 'doc')).toEqual(['doc:b']);

  indexer.connection.disconnect();
});

test("another context's write is seen once it says so", async () => {
  const options = {
    id: `exists-shared-${counter++}`,
    flavour: 'test',
    type: 'workspace' as const,
  };
  const reader = new IndexedDBIndexerStorage(options);
  reader.connection.connect();
  await reader.connection.waitForConnected();
  await reader.insert('block', block('doc', 'a', 'other'));
  await reader.refresh('block');
  expect(await linked(reader, 'doc')).toEqual(['doc:a']);

  // What a second tab's write does: change the rows, then announce it on
  // the database's channel.
  const { db } = reader.connection.inner;
  const trx = db.transaction(
    ['indexerRecords', 'invertedIndex', 'indexerMetadata'],
    'readwrite'
  );
  await trx.objectStore('invertedIndex').clear();
  await trx.objectStore('indexerRecords').clear();
  await trx.done;
  const announce = new BroadcastChannel(reader.channel.name);
  announce.postMessage({ type: 'indexer-updated', table: 'block' });
  await vi.waitFor(async () => {
    expect(await linked(reader, 'doc')).toEqual([]);
  });
  announce.close();

  reader.connection.disconnect();
});

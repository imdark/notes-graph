import test from 'ava';
import * as Y from 'yjs';

import {
  buildSeed,
  isSeeded,
  rebuiltTableDocIds,
  RebuiltTableSeeder,
  rebuiltTableSource,
  SEED_CLIENT_ID,
  type SeedStorage,
} from '../rebuilt-tables';

const WS = 'ws-1';
const OLD = `db$${WS}$docProperties`;
const NEW = `db$${WS}$docProperties2`;
const DELETED_FLAG = '$$DELETED';

/** A table as it is after use: rows rewritten many times, one deleted. */
function usedTable() {
  const doc = new Y.Doc();
  for (let round = 0; round < 20; round++) {
    for (const id of ['a', 'b', 'c']) {
      const row = doc.getMap(id);
      row.set('id', id);
      row.set('updatedBy', `user-${round}`);
    }
  }
  doc.getMap('a').set('journal', '2026-11-27');
  doc
    .getMap('b')
    .set('publishSite', { enabled: true, theme: { font: 'Sans' } });
  const gone = doc.getMap('c');
  gone.delete('updatedBy');
  gone.set(DELETED_FLAG, true);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

const rows = (bin: Uint8Array) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bin);
  return Object.fromEntries(
    [...doc.share.keys()].sort().map(key => [key, doc.getMap(key).toJSON()])
  );
};

const deletedIds = (bin: Uint8Array) =>
  [...Y.decodeUpdate(bin).ds.clients.values()].flat().length;

test('only a rebuilt table has a source', t => {
  t.is(rebuiltTableSource(WS, NEW), OLD);
  t.is(rebuiltTableSource(WS, OLD), null);
  t.is(rebuiltTableSource(WS, 'some-note'), null);
  t.is(rebuiltTableSource(WS, `db$other-ws$docProperties2`), null);
  t.is(rebuiltTableSource(WS, `userdata$u1$docProperties2`), null);
});

test('every rebuilt table of a workspace has a source', t => {
  t.deepEqual(rebuiltTableDocIds(WS), [NEW]);
  for (const docId of rebuiltTableDocIds(WS)) {
    t.truthy(rebuiltTableSource(WS, docId));
  }
});

test('the seed has the live rows and none of the history', t => {
  const old = usedTable();
  const seed = buildSeed(old) as Uint8Array;

  t.deepEqual(rows(seed), {
    a: { id: 'a', updatedBy: 'user-19', journal: '2026-11-27' },
    b: {
      id: 'b',
      updatedBy: 'user-19',
      publishSite: { enabled: true, theme: { font: 'Sans' } },
    },
  });
  t.true(deletedIds(old) > 0);
  t.is(deletedIds(seed), 0);
  t.true(seed.byteLength < old.byteLength / 2);
  t.true(isSeeded(seed));
  t.false(isSeeded(old));
  t.deepEqual(
    [...Y.decodeStateVector(Y.encodeStateVectorFromUpdate(seed)).keys()],
    [SEED_CLIENT_ID]
  );
});

test('a table with no live rows has no seed', t => {
  const doc = new Y.Doc();
  doc.getMap('x').set(DELETED_FLAG, true);
  t.is(buildSeed(Y.encodeStateAsUpdate(doc)), null);
  t.is(buildSeed(Y.encodeStateAsUpdate(new Y.Doc())), null);
});

test("a field a client already wrote keeps the client's value, whichever arrives first", t => {
  const seed = buildSeed(usedTable()) as Uint8Array;
  const client = new Y.Doc();
  client.getMap('a').set('id', 'a');
  client.getMap('a').set('updatedBy', 'someone-new');
  client.getMap('d').set('id', 'd');
  const written = Y.encodeStateAsUpdate(client);

  for (const order of [
    [seed, written],
    [written, seed],
  ]) {
    const doc = new Y.Doc();
    order.forEach(update => Y.applyUpdate(doc, update));
    t.deepEqual(rows(Y.encodeStateAsUpdate(doc)), {
      a: { id: 'a', updatedBy: 'someone-new', journal: '2026-11-27' },
      b: {
        id: 'b',
        updatedBy: 'user-19',
        publishSite: { enabled: true, theme: { font: 'Sans' } },
      },
      d: { id: 'd' },
    });
  }
});

/** Doc storage in memory: each doc is the list of updates pushed to it. */
function memoryStorage(initial: Record<string, Uint8Array[]> = {}) {
  const docs = new Map(Object.entries(initial));
  const calls = { getDoc: 0, pushes: [] as string[], locks: [] as string[] };
  const storage: SeedStorage = {
    async getDoc(_ws, docId) {
      calls.getDoc++;
      const updates = docs.get(docId);
      return updates?.length ? { bin: Y.mergeUpdates(updates) } : null;
    },
    async pushDocUpdates(_ws, docId, updates) {
      calls.pushes.push(docId);
      docs.set(docId, [...(docs.get(docId) ?? []), ...updates]);
    },
    async lock(_ws, docId) {
      calls.locks.push(docId);
      return { [Symbol.asyncDispose]: async () => {} };
    },
  };
  const read = (docId: string) => rows(Y.mergeUpdates(docs.get(docId) ?? []));
  return { storage, calls, read };
}

test('the first read of a rebuilt table copies its rows in, once', async t => {
  const { storage, calls, read } = memoryStorage({ [OLD]: [usedTable()] });
  const seeder = new RebuiltTableSeeder(storage);

  await Promise.all([seeder.ensure(WS, NEW), seeder.ensure(WS, NEW)]);
  await seeder.ensure(WS, NEW);

  t.deepEqual(calls.pushes, [NEW]);
  t.deepEqual(calls.locks, [`${NEW}:seed`]);
  t.deepEqual(Object.keys(read(NEW)), ['a', 'b']);

  // After a restart the doc itself says it was seeded.
  await new RebuiltTableSeeder(storage).ensure(WS, NEW);
  t.deepEqual(calls.pushes, [NEW]);
});

test('other docs are not looked at', async t => {
  const { storage, calls } = memoryStorage({ [OLD]: [usedTable()] });
  const seeder = new RebuiltTableSeeder(storage);
  await seeder.ensure(WS, OLD);
  await seeder.ensure(WS, 'some-note');
  t.is(calls.getDoc, 0);
  t.deepEqual(calls.pushes, []);
});

test('a workspace with no old table gets nothing, and is asked once', async t => {
  const { storage, calls } = memoryStorage();
  const seeder = new RebuiltTableSeeder(storage);
  await seeder.ensure(WS, NEW);
  const reads = calls.getDoc;
  await seeder.ensure(WS, NEW);
  t.deepEqual(calls.pushes, []);
  t.is(calls.getDoc, reads);
});

test("rows a client pushed before the first read are merged with the copy, the client's fields on top", async t => {
  const client = new Y.Doc();
  client.getMap('a').set('id', 'a');
  client.getMap('a').set('updatedBy', 'someone-new');
  const { storage, read } = memoryStorage({
    [OLD]: [usedTable()],
    [NEW]: [Y.encodeStateAsUpdate(client)],
  });

  await new RebuiltTableSeeder(storage).ensure(WS, NEW);

  t.deepEqual(read(NEW).a, {
    id: 'a',
    updatedBy: 'someone-new',
    journal: '2026-11-27',
  });
  t.deepEqual(Object.keys(read(NEW)), ['a', 'b']);
});

test('a failed copy is tried again on the next read', async t => {
  const { storage, calls } = memoryStorage({ [OLD]: [usedTable()] });
  const push = storage.pushDocUpdates;
  let fail = true;
  storage.pushDocUpdates = async (...args) => {
    if (fail) throw new Error('db down');
    return push(...args);
  };
  const seeder = new RebuiltTableSeeder(storage);

  await t.throwsAsync(() => seeder.ensure(WS, NEW), { message: 'db down' });
  fail = false;
  await seeder.ensure(WS, NEW);
  t.deepEqual(calls.pushes, [NEW]);
});

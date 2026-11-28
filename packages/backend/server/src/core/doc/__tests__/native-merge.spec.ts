import test from 'ava';
import * as Y from 'yjs';

import { mergeUpdatesInApplyWayAsync } from '../../../native';
import { compareCodecResult } from '../codec-compare';
import {
  applyUpdatesWithNativeAsync,
  applyUpdatesWithYjs,
  totalBytes,
} from '../merge-updates';
import { DocStorageOptions } from '../options';

/** Three devices editing one doc, concurrently and with deletes. */
function history() {
  const updates: Uint8Array[] = [];
  const docs = [1, 2, 3].map(clientID => {
    const doc = new Y.Doc();
    doc.clientID = clientID;
    doc.on('update', (update: Uint8Array) => updates.push(update));
    return doc;
  });
  const [a, b, c] = docs;
  const sync = (from: Y.Doc, to: Y.Doc) =>
    Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));

  a.getMap('props').set('title', 'first');
  a.getText('body').insert(0, 'hello world');
  a.getArray('rows').push([{ id: 1 }, { id: 2 }, { id: 3 }]);
  sync(a, b);
  sync(a, c);
  // The same key and the same text, edited without seeing each other.
  b.getMap('props').set('title', 'from b');
  c.getMap('props').set('title', 'from c');
  b.getText('body').delete(0, 6);
  c.getText('body').insert(11, '!');
  c.getArray('rows').delete(1, 1);
  a.getMap('props').set('nested', new Y.Map([['k', 'v']]));
  sync(b, a);
  sync(c, a);
  a.getMap('props').delete('title');
  a.getMap('props').set('title', 'last');
  return updates;
}

const read = (binary: Uint8Array, more: Uint8Array[] = []) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, binary);
  more.forEach(update => Y.applyUpdate(doc, update));
  return {
    props: doc.getMap('props').toJSON(),
    body: doc.getText('body').toString(),
    rows: doc.getArray('rows').toJSON(),
  };
};

const options = (nativeMergeMinBytes: number) =>
  new DocStorageOptions(
    {
      doc: {
        nativeMergeMinBytes,
        experimental: { yocto: false },
        history: { interval: 1 },
      },
    } as any,
    {} as any
  );

test('the off-thread native merge gives the doc yjs gives', async t => {
  const updates = history();
  const yjs = await applyUpdatesWithYjs(updates, 'test');
  const native = await applyUpdatesWithNativeAsync(updates, 'test');

  t.truthy(native);
  t.true(compareCodecResult(yjs, native!).matches);
  t.deepEqual(read(native!), read(yjs));
  t.deepEqual(
    Y.encodeStateVectorFromUpdate(native!),
    Y.encodeStateVectorFromUpdate(yjs)
  );
});

test('updates in any order merge to the same doc', async t => {
  const updates = history();
  const yjs = await applyUpdatesWithYjs(updates, 'test');
  const reversed = await applyUpdatesWithNativeAsync(
    [...updates].reverse(),
    'test'
  );
  t.deepEqual(read(reversed!), read(yjs));
});

test('an update whose predecessor has not arrived is kept until it does', async t => {
  // One device's edits, each building on the one before.
  const updates: Uint8Array[] = [];
  const device = new Y.Doc();
  device.on('update', (update: Uint8Array) => updates.push(update));
  device.getMap('props').set('title', 'first');
  device.getText('body').insert(0, 'hello');
  device.getText('body').insert(5, ' world');
  device.getMap('props').set('title', 'last');
  device.getText('body').delete(0, 6);
  // The second update never reached the server; what follows depends on it.
  const [missing] = updates.splice(1, 1);
  const whole = read(await applyUpdatesWithYjs([...updates, missing], 'test'));

  const yjs = await applyUpdatesWithYjs(updates, 'test');
  const native = await applyUpdatesWithNativeAsync(updates, 'test');

  t.deepEqual(read(native!), read(yjs));
  t.notDeepEqual(read(native!), whole);
  // Once it arrives the doc is complete: nothing was dropped by the merge.
  t.deepEqual(read(native!, [missing]), whole);
  t.deepEqual(read(yjs, [missing]), whole);
});

test('a merge that was merged again is unchanged', async t => {
  const updates = history();
  const once = await applyUpdatesWithNativeAsync(updates, 'test');
  const twice = await applyUpdatesWithNativeAsync([once!], 'test');
  const withLater = await applyUpdatesWithNativeAsync(
    [once!, updates.at(-1)!],
    'test'
  );
  t.deepEqual(read(twice!), read(once!));
  t.deepEqual(read(withLater!), read(once!));
});

test('a merge that throws or comes back empty is not used', async t => {
  const warned: string[] = [];
  const logger = { warn: (message: string) => warned.push(message) };
  const updates = history();

  t.is(
    await applyUpdatesWithNativeAsync(updates, 'test', logger, async () => {
      throw new Error('worker died');
    }),
    null
  );
  t.is(
    await applyUpdatesWithNativeAsync(updates, 'test', logger, async () =>
      Buffer.from([0, 0])
    ),
    null
  );
  // The real one, given bytes that are no update.
  t.is(
    await applyUpdatesWithNativeAsync([Buffer.from([0])], 'test', logger),
    null
  );
  t.is(warned.length, 3);
  t.regex(warned[0], /worker died/);
});

test('only a merge at or above the size limit leaves the main thread', async t => {
  const updates = history();
  const size = totalBytes(updates);
  const calls: number[] = [];
  const wired = (minBytes: number) => {
    const doc = options(minBytes);
    doc.nativeMerge = async merging => {
      calls.push(merging.length);
      return mergeUpdatesInApplyWayAsync(merging.map(u => Buffer.from(u)));
    };
    return doc;
  };

  const expected = read(await applyUpdatesWithYjs(updates, 'test'));
  t.deepEqual(read(await wired(size).mergeUpdates(updates)), expected);
  t.is(calls.length, 1);
  t.deepEqual(read(await wired(size + 1).mergeUpdates(updates)), expected);
  t.is(calls.length, 1);
  // 0 turns it off, whatever the size.
  t.deepEqual(read(await wired(0).mergeUpdates(updates)), expected);
  t.is(calls.length, 1);
});

test('when the native merge is not usable the doc is merged with yjs', async t => {
  const updates = history();
  const doc = options(1);
  doc.nativeMerge = async () => null;
  t.deepEqual(
    read(await doc.mergeUpdates(updates)),
    read(await applyUpdatesWithYjs(updates, 'test'))
  );
});

test('the native merge does not hold the main thread', async t => {
  // A doc large enough to take a while: many small edits by many clients.
  const updates: Uint8Array[] = [];
  for (let client = 1; client <= 40; client++) {
    const doc = new Y.Doc();
    doc.clientID = client;
    doc.on('update', (update: Uint8Array) => updates.push(update));
    const rows = doc.getMap('rows');
    for (let i = 0; i < 400; i++) {
      rows.set(`row-${i % 50}`, `value ${client}-${i}`);
    }
  }
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  const started = performance.now();
  const merged = await applyUpdatesWithNativeAsync(updates, 'test');
  const took = performance.now() - started;
  clearInterval(timer);

  t.truthy(merged);
  // The timer kept firing while the merge ran: at least once per 5 ms of it.
  t.true(ticks >= Math.floor(took / 5), `${ticks} ticks in ${took} ms`);
});

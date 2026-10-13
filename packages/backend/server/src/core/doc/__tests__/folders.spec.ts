import test from 'ava';
import * as Y from 'yjs';

import { fileDocInFolders, foldersDocId, indexAfter } from '../folders';

/** The folders table as the app's Yjs table adapter would list it. */
function rows(bin: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bin);
  return [...doc.share.keys()]
    .map(key => doc.getMap(key).toJSON())
    .filter(row => Object.keys(row).length > 0 && row.$$DELETED !== true);
}

function apply(state: Uint8Array, update: Uint8Array) {
  const doc = new Y.Doc();
  if (state.length) Y.applyUpdate(doc, state);
  Y.applyUpdate(doc, update);
  return Y.encodeStateAsUpdate(doc);
}

test('the table doc is named as the app syncs it', t => {
  t.is(foldersDocId('ws-1'), 'db$ws-1$folders');
});

test('filing into a new path makes each folder and files the doc', t => {
  const { update, folderId } = fileDocInFolders(
    new Uint8Array(),
    ['personal', 'ai', 'conversations'],
    'doc-1'
  );
  const all = rows(update);
  const personal = all.find(r => r.type === 'folder' && r.data === 'personal')!;
  const ai = all.find(r => r.type === 'folder' && r.data === 'ai')!;
  const conversations = all.find(
    r => r.type === 'folder' && r.data === 'conversations'
  )!;
  t.falsy(personal.parentId, 'the outermost folder sits at the top');
  t.is(ai.parentId, personal.id);
  t.is(conversations.parentId, ai.id);
  t.is(folderId, conversations.id);
  const filed = all.find(r => r.type === 'doc')!;
  t.deepEqual(
    { parentId: filed.parentId, data: filed.data },
    { parentId: conversations.id, data: 'doc-1' }
  );
  for (const row of all) {
    t.truthy(row.id, 'every row keeps its id');
    t.truthy(row.index, 'every row has an order key');
  }
});

test('filing again reuses the folders and adds only the new doc', t => {
  const first = fileDocInFolders(new Uint8Array(), ['personal', 'ai'], 'doc-1');
  const state = apply(new Uint8Array(), first.update);

  const again = fileDocInFolders(state, ['personal', 'ai'], 'doc-1');
  t.is(again.folderId, first.folderId);
  t.is(
    rows(apply(state, again.update)).length,
    rows(state).length,
    'nothing new'
  );

  const second = fileDocInFolders(state, ['personal', 'ai'], 'doc-2');
  const after = rows(apply(state, second.update));
  t.is(second.folderId, first.folderId);
  t.is(after.filter(r => r.type === 'folder').length, 2);
  t.is(after.filter(r => r.type === 'doc').length, 2);
});

test('a deleted folder of the same name is not reused', t => {
  const first = fileDocInFolders(new Uint8Array(), ['ai'], 'doc-1');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, first.update);
  doc.getMap(first.folderId).set('$$DELETED', true);
  const state = Y.encodeStateAsUpdate(doc);

  const next = fileDocInFolders(state, ['ai'], 'doc-2');
  t.not(next.folderId, first.folderId);
});

test('order keys come after the last sibling, in the app format', t => {
  const a = indexAfter(null);
  const b = indexAfter(a);
  t.true(a < b);
  t.regex(a, /^[a-zA-Z0-9]+0[1-9A-Za-z]{32}$/);
});

test('an empty path is refused', t => {
  t.throws(() => fileDocInFolders(new Uint8Array(), ['  '], 'doc-1'));
});

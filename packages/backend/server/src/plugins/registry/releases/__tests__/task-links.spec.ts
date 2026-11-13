import test from 'ava';
import * as Y from 'yjs';

import {
  deployedNote,
  deployTasks,
  mergeTasks,
  readTaskLinks,
  ticketKey,
} from '../task-links';

const REPO = 'imdark/notes-graph';

interface Spec {
  text: string;
  chip?: string;
  checkbox?: boolean;
  children?: string[];
}

/** A doc of list blocks with children, as the editor stores them. */
function makeDoc(blocks: Record<string, Spec>) {
  const doc = new Y.Doc();
  const map = doc.getMap<Y.Map<unknown>>('blocks');
  for (const [id, spec] of Object.entries(blocks)) {
    const block = new Y.Map<unknown>();
    const text = new Y.Text();
    const children = new Y.Array<string>();
    block.set('sys:id', id);
    block.set('sys:flavour', 'notesgraph:list');
    block.set('sys:children', children);
    block.set('prop:type', spec.checkbox ? 'todo' : 'bulleted');
    block.set('prop:checked', false);
    block.set('prop:text', text);
    map.set(id, block);
    text.insert(0, spec.text);
    if (spec.chip) text.insert(0, ' ', { orgStatus: spec.chip });
    children.push(spec.children ?? []);
  }
  return doc;
}

const blocksOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('blocks');

function status(doc: Y.Doc, id: string): string {
  const text = blocksOf(doc).get(id)!.get('prop:text') as Y.Text;
  const first = text.toDelta()[0] as { attributes?: { orgStatus?: string } };
  return first?.attributes?.orgStatus ?? text.toString();
}

function childTexts(doc: Y.Doc, id: string): string[] {
  const blocks = blocksOf(doc);
  const children = blocks.get(id)!.get('sys:children') as Y.Array<string>;
  return children
    .toArray()
    .map(child => (blocks.get(child)!.get('prop:text') as Y.Text).toString());
}

function apply(doc: Y.Doc, edit: { update: Uint8Array | null }) {
  if (edit.update) Y.applyUpdate(doc, edit.update);
}

const AT = new Date('2026-11-12T12:00:00Z');
const SHA = '41ec8a69504c85ea1fd0aff56900e03b49b62006';

test('ticket keys come from the start of a branch', t => {
  t.is(ticketKey('personal-259-Back-up-YouTube'), 'PERSONAL-259');
  t.is(ticketKey('TASK-14-Scoped-agent-rules'), 'TASK-14');
  t.is(ticketKey('fix/ask-graph-icon'), null);
  t.is(ticketKey('main'), null);
});

test('tasks link by PR URL in their notes, or by the branch ticket key', t => {
  const doc = makeDoc({
    byUrl: {
      text: ' Scoped rules follow-up',
      chip: 'COMMITTED',
      children: ['note'],
    },
    note: { text: `PR: https://github.com/${REPO}/pull/371` },
    byKey: { text: ' PERSONAL-259 back up videos', chip: '[-]' },
    otherRepo: {
      text: ' https://github.com/someone/else/pull/371',
      chip: 'COMMITTED',
    },
    longerKey: { text: ' PERSONAL-2590 something else', chip: '[-]' },
    plain: { text: `just a line https://github.com/${REPO}/pull/371` },
    nothing: { text: ' unrelated', chip: 'MERGED' },
  });
  const links = readTaskLinks(
    Y.encodeStateAsUpdate(doc),
    ['byUrl', 'byKey', 'otherRepo', 'longerKey', 'plain', 'nothing', 'gone'],
    REPO,
    [
      { number: 371, branch: 'task-20-scoped-follow-up' },
      { number: 372, branch: 'personal-259-Back-up-YouTube' },
    ]
  );
  t.deepEqual(links, [
    {
      blockId: 'byUrl',
      title: 'Scoped rules follow-up',
      status: 'COMMITTED',
      prs: [371],
    },
    {
      blockId: 'byKey',
      title: 'PERSONAL-259 back up videos',
      status: '[-]',
      prs: [372],
    },
  ]);
});

test('a merge moves in-progress and COMMITTED tasks to MERGED, nothing else', t => {
  const doc = makeDoc({
    busy: { text: ' a', chip: '[-]' },
    committed: { text: ' b', chip: 'COMMITTED' },
    typed: { text: 'COMMITTED c' },
    merged: { text: ' d', chip: 'MERGED' },
    todo: { text: ' e', chip: '[ ]' },
    box: { text: 'f', checkbox: true },
  });
  const ids = ['busy', 'committed', 'typed', 'merged', 'todo', 'box'];
  const edit = mergeTasks(Y.encodeStateAsUpdate(doc), ids);
  apply(doc, edit);
  t.deepEqual(edit.changed, ['busy', 'committed', 'typed']);
  t.is(status(doc, 'busy'), 'MERGED');
  t.is(status(doc, 'committed'), 'MERGED');
  t.is(status(doc, 'typed'), 'MERGED');
  t.is(status(doc, 'todo'), '[ ]');
  t.is(status(doc, 'box'), 'f');
  t.deepEqual(childTexts(doc, 'busy'), []);
  t.is(mergeTasks(Y.encodeStateAsUpdate(doc), ids).update, null);
});

test('a deploy moves in-progress, COMMITTED and MERGED tasks to DEPLOYED with one note', t => {
  const doc = makeDoc({
    busy: { text: ' a', chip: '[-]' },
    committed: { text: ' b', chip: 'COMMITTED', children: ['n1'] },
    n1: { text: 'https://github.com/o/r/pull/1' },
    merged: { text: ' c', chip: 'MERGED' },
    done: { text: ' d', chip: '[X]' },
    todo: { text: ' e', chip: '[ ]' },
    box: { text: 'f', checkbox: true },
  });
  const ids = ['busy', 'committed', 'merged', 'done', 'todo', 'box'];
  const edit = deployTasks(Y.encodeStateAsUpdate(doc), ids, SHA, AT);
  apply(doc, edit);

  t.deepEqual(edit.changed, ['busy', 'committed', 'merged']);
  const note = deployedNote(SHA, AT);
  t.regex(note, /^Deployed 41ec8a6 on \d{1,2}\/\d{1,2}\/2026\.$/);
  for (const id of ['busy', 'committed', 'merged']) {
    t.is(status(doc, id), 'DEPLOYED');
  }
  t.deepEqual(childTexts(doc, 'busy'), [note]);
  t.deepEqual(childTexts(doc, 'committed'), [
    'https://github.com/o/r/pull/1',
    note,
  ]);
  t.is(status(doc, 'done'), '[X]');
  t.is(status(doc, 'todo'), '[ ]');
  t.deepEqual(childTexts(doc, 'todo'), []);

  // The note is a real paragraph block.
  const blocks = blocksOf(doc);
  const noteId = (
    blocks.get('busy')!.get('sys:children') as Y.Array<string>
  ).get(0);
  t.is(blocks.get(noteId)!.get('sys:flavour'), 'notesgraph:paragraph');

  // Again: nothing to move, no second note.
  const again = deployTasks(Y.encodeStateAsUpdate(doc), ids, SHA, AT);
  t.is(again.update, null);
  t.deepEqual(again.changed, []);
  apply(doc, again);
  t.deepEqual(childTexts(doc, 'busy'), [note]);
});

import test from 'ava';
import * as Y from 'yjs';

import { queueTasks, releaseTasks, startTasks } from '../task-status';

/** A doc of list blocks, as the editor stores them. */
function makeDoc(
  blocks: Record<string, { text: string; chip?: string; checkbox?: boolean }>
) {
  const doc = new Y.Doc();
  const map = doc.getMap<Y.Map<unknown>>('blocks');
  for (const [id, spec] of Object.entries(blocks)) {
    const block = new Y.Map<unknown>();
    const text = new Y.Text();
    block.set('sys:id', id);
    block.set('sys:flavour', 'notesgraph:list');
    block.set('prop:type', spec.checkbox ? 'todo' : 'bulleted');
    block.set('prop:checked', false);
    block.set('prop:text', text);
    map.set(id, block);
    text.insert(0, spec.text);
    if (spec.chip) text.insert(0, ' ', { orgStatus: spec.chip });
  }
  return doc;
}

/** Apply an edit's update to the doc, the way the server's push would. */
function apply(doc: Y.Doc, edit: { update: Uint8Array | null }) {
  if (edit.update) Y.applyUpdate(doc, edit.update);
}

/** A block's status as the editor reads it: the chip, else the text. */
function status(doc: Y.Doc, id: string): string {
  const text = doc.getMap<Y.Map<unknown>>('blocks').get(id)!.get('prop:text') as Y.Text;
  const first = text.toDelta()[0] as { attributes?: { orgStatus?: string } };
  return first?.attributes?.orgStatus ?? text.toString();
}

test('queues to-do tasks only', t => {
  const doc = makeDoc({
    typed: { text: '[ ] write it' },
    chip: { text: ' write it', chip: '[ ]' },
    box: { text: 'write it', checkbox: true },
    busy: { text: ' write it', chip: '[-]' },
    plain: { text: 'just a line' },
  });
  const edit = queueTasks(Y.encodeStateAsUpdate(doc), [
    'typed', 'chip', 'box', 'busy', 'plain', 'missing',
  ]);
  apply(doc, edit);

  t.deepEqual(edit.changed, ['typed', 'chip', 'box']);
  t.is(status(doc, 'typed'), 'QUEUED');
  t.is(status(doc, 'chip'), 'QUEUED');
  t.is(status(doc, 'box'), 'QUEUED');
  t.is(status(doc, 'busy'), '[-]');
  t.is(status(doc, 'plain'), 'just a line');
  // The typed annotation becomes the chip, not chip plus annotation.
  const typed = doc.getMap<Y.Map<unknown>>('blocks').get('typed')!.get('prop:text') as Y.Text;
  t.is(typed.toString(), '  write it');
});

test('nothing to change, nothing to push', t => {
  const doc = makeDoc({ done: { text: ' shipped', chip: '[X]' } });
  const edit = queueTasks(Y.encodeStateAsUpdate(doc), ['done']);
  t.is(edit.update, null);
  t.deepEqual(edit.changed, []);
});

test('a claimed job starts its queued tasks', t => {
  const doc = makeDoc({
    a: { text: ' one', chip: 'QUEUED' },
    b: { text: ' two', chip: 'COMMITTED' },
  });
  const edit = startTasks(Y.encodeStateAsUpdate(doc), ['a', 'b']);
  apply(doc, edit);

  t.deepEqual(edit.changed, ['a']);
  t.is(status(doc, 'a'), '[-]');
  t.is(status(doc, 'b'), 'COMMITTED');
});

test('an ended job hands back what it left, not what the agent moved on', t => {
  const doc = makeDoc({
    queued: { text: ' never reached', chip: 'QUEUED' },
    ours: { text: ' started by the claim', chip: '[-]' },
    agents: { text: ' started by the agent', chip: '[-]' },
    done: { text: ' finished', chip: '[X]' },
  });
  const edit = releaseTasks(
    Y.encodeStateAsUpdate(doc),
    ['queued', 'ours', 'agents', 'done'],
    ['ours', 'done']
  );
  apply(doc, edit);

  t.deepEqual(edit.changed, ['queued', 'ours']);
  t.is(status(doc, 'queued'), '[ ]');
  t.is(status(doc, 'ours'), '[ ]');
  t.is(status(doc, 'agents'), '[-]');
  t.is(status(doc, 'done'), '[X]');
});

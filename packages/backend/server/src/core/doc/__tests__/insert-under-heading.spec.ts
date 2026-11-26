import test from 'ava';
import * as Y from 'yjs';

import { createDocWithMarkdown } from '../../../native';
import { insertUnderHeading } from '../blocksuite-headless';

const docId = 'journal';

/** The note's children, in order, as "flavour/type: text" with the block id. */
function outline(binary: Uint8Array, ...updates: Uint8Array[]) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, binary);
  for (const update of updates) Y.applyUpdate(doc, update);
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  let note: Y.Map<unknown> | undefined;
  blocks.forEach(block => {
    if (block.get('sys:flavour') === 'notesgraph:note') note = block;
  });
  const ids = (note!.get('sys:children') as Y.Array<string>).toArray();
  return ids.map(id => {
    const block = blocks.get(id)!;
    const flavour = String(block.get('sys:flavour')).replace('notesgraph:', '');
    const text = block.get('prop:text');
    return {
      id,
      line: `${flavour}/${block.get('prop:type')}: ${text instanceof Y.Text ? text.toString() : ''}`,
      delta: text instanceof Y.Text ? text.toDelta() : null,
      json: JSON.stringify(block.toJSON()),
    };
  });
}

const journal = () =>
  createDocWithMarkdown(
    '2026-11-26',
    '## notes-graph\n\n- [ ] \n\n## workflow\n\n- [ ] \n\n## Inbox\n\nSomething I wrote.',
    docId
  );

test('fills the empty todo under the heading, matching its name loosely', t => {
  const original = journal();
  const before = outline(original);

  const delta = insertUnderHeading(original, docId, 'notes graph', [
    'PERSONAL-1 Do the thing',
  ]);
  const after = outline(original, delta);

  t.deepEqual(
    after.map(b => b.line),
    [
      'paragraph/h2: notes-graph',
      'list/todo: PERSONAL-1 Do the thing',
      'paragraph/h2: workflow',
      'list/todo: ',
      'paragraph/h2: Inbox',
      'paragraph/text: Something I wrote.',
    ]
  );
  // Same blocks, same ids: only the filled todo's text changed.
  t.deepEqual(
    after.map(b => b.id),
    before.map(b => b.id)
  );
  for (const [i, block] of before.entries()) {
    if (i !== 1) t.is(after[i].json, block.json, `block ${i} untouched`);
  }
});

test('adds after the section’s items, before a subheading', t => {
  const original = createDocWithMarkdown(
    '2026-11-26',
    '## notes-graph\n\n- [ ] First\n\n### todos:\n\n- [ ] Later\n\n## Inbox',
    docId
  );
  const before = outline(original);

  const delta = insertUnderHeading(original, docId, 'notes-graph', [
    'Second',
    'Third',
  ]);
  const after = outline(original, delta);

  t.deepEqual(
    after.map(b => b.line),
    [
      'paragraph/h2: notes-graph',
      'list/todo: First',
      'list/todo: Second',
      'list/todo: Third',
      'paragraph/h3: todos:',
      'list/todo: Later',
      'paragraph/h2: Inbox',
    ]
  );
  for (const block of before) {
    t.is(
      after.find(b => b.id === block.id)?.json,
      block.json,
      `${block.line} untouched`
    );
  }
});

test('adds a missing heading before Inbox', t => {
  const original = journal();

  const delta = insertUnderHeading(original, docId, 'docs', ['A task']);

  t.deepEqual(
    outline(original, delta).map(b => b.line),
    [
      'paragraph/h2: notes-graph',
      'list/todo: ',
      'paragraph/h2: workflow',
      'list/todo: ',
      'paragraph/h2: docs',
      'list/todo: A task',
      'paragraph/h2: Inbox',
      'paragraph/text: Something I wrote.',
    ]
  );
});

test('adds a missing heading at the end when there is no Inbox', t => {
  const original = createDocWithMarkdown('2026-11-26', 'Just a line.', docId);

  const delta = insertUnderHeading(original, docId, 'workflow', ['A task']);

  t.deepEqual(
    outline(original, delta).map(b => b.line),
    [
      'paragraph/text: Just a line.',
      'paragraph/h2: workflow',
      'list/todo: A task',
    ]
  );
});

test('a markdown link becomes linked text', t => {
  const original = journal();

  const delta = insertUnderHeading(original, docId, 'workflow', [
    '[PERSONAL-2](https://example.com/p/2) Fix it #repo:workflow',
  ]);
  const item = outline(original, delta)[3];

  t.is(item.line, 'list/todo: PERSONAL-2 Fix it #repo:workflow');
  t.deepEqual(item.delta, [
    { insert: 'PERSONAL-2', attributes: { link: 'https://example.com/p/2' } },
    { insert: ' Fix it #repo:workflow' },
  ]);
});

test('nothing to add changes nothing', t => {
  const original = journal();

  const delta = insertUnderHeading(original, docId, 'workflow', []);

  t.deepEqual(
    outline(original, delta).map(b => b.json),
    outline(original).map(b => b.json)
  );
});

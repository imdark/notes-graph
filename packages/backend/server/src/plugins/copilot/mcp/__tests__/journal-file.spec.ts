import test from 'ava';
import * as Y from 'yjs';

import { fileTaskInJournal, taskLine } from '../journal-file';

/** Filing a task in a journal edits only the section it goes in. */

type Spec = {
  id: string;
  flavour: string;
  props?: Record<string, unknown>;
  children?: Spec[];
};

const h2 = (id: string, name: string, children: Spec[] = []): Spec => ({
  id,
  flavour: 'notesgraph:paragraph',
  props: { type: 'h2', text: name },
  children,
});
const todo = (id: string, text = ''): Spec => ({
  id,
  flavour: 'notesgraph:list',
  props: { type: 'todo', text, checked: false },
});
const taskList = (id: string, projectId: string): Spec => ({
  id,
  flavour: 'notesgraph:database',
  props: { title: 'todos:', queryProjectId: projectId },
});

/** A journal page whose note holds `sections`, as the app scaffolds it. */
function journal(sections: Spec[]): Uint8Array {
  const doc = new Y.Doc();
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  const add = (spec: Spec): string => {
    const block = new Y.Map<unknown>();
    block.set('sys:id', spec.id);
    block.set('sys:flavour', spec.flavour);
    const children = new Y.Array<string>();
    children.push((spec.children ?? []).map(add));
    block.set('sys:children', children);
    for (const [key, value] of Object.entries(spec.props ?? {})) {
      if (key === 'text' || key === 'title') {
        const text = new Y.Text();
        text.insert(0, String(value));
        block.set(`prop:${key}`, text);
      } else {
        block.set(`prop:${key}`, value);
      }
    }
    blocks.set(spec.id, block);
    return spec.id;
  };
  doc.transact(() => {
    add({
      id: 'page',
      flavour: 'notesgraph:page',
      children: [
        { id: 'note', flavour: 'notesgraph:note', children: sections },
      ],
    });
  });
  return Y.encodeStateAsUpdate(doc);
}

const DAY = () =>
  journal([
    h2('work', 'Work', [todo('work-empty')]),
    taskList('work-list', 'p-work'),
    h2('graph', 'notes graph', [
      todo('graph-1', 'when an'),
      todo('graph-empty'),
    ]),
    taskList('graph-list', 'p-graph'),
    h2('inbox', 'Inbox', [todo('inbox-empty')]),
    taskList('inbox-list', ''),
  ]);

/** The base doc with `update` applied, and a reader over its blocks. */
function apply(base: Uint8Array, update: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, base);
  Y.applyUpdate(doc, update);
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  const block = (id: string) => blocks.get(id)!;
  const children = (id: string) =>
    (block(id).get('sys:children') as Y.Array<string>).toArray();
  const text = (id: string) => String(block(id).get('prop:text') ?? '');
  return { blocks, block, children, text };
}

test('a task goes under its project heading, above the empty to-do', t => {
  const base = DAY();
  const filed = fileTaskInJournal(
    base,
    'day',
    { name: 'notes graph', projectId: 'p-graph' },
    'PERSONAL-330 Fix it'
  );
  const after = apply(base, filed.update);

  t.false(filed.createdSection);
  t.deepEqual(after.children('graph'), [
    'graph-1',
    filed.blockId,
    'graph-empty',
  ]);
  t.is(after.text(filed.blockId), 'PERSONAL-330 Fix it');
  t.is(after.block(filed.blockId).get('sys:flavour'), 'notesgraph:list');
  t.is(after.block(filed.blockId).get('prop:type'), 'todo');
  t.is(after.block(filed.blockId).get('prop:checked'), false);
});

test('nothing outside the section changes: no tables, no copies', t => {
  const base = DAY();
  const before = apply(base, Y.encodeStateAsUpdate(new Y.Doc()));
  const filed = fileTaskInJournal(
    base,
    'day',
    { name: 'Work', projectId: 'p-work' },
    'Ship'
  );
  const after = apply(base, filed.update);

  t.deepEqual(after.children('note'), before.children('note'));
  t.is(after.blocks.size, before.blocks.size + 1);
  const flavours = [...after.blocks.values()].map(b => b.get('sys:flavour'));
  t.false(flavours.includes('notesgraph:table'));
  t.is(flavours.filter(f => f === 'notesgraph:database').length, 3);
});

test('the heading matches as the app matches it', t => {
  const base = DAY();
  const filed = fileTaskInJournal(
    base,
    'day',
    { name: 'Notes_Graph', projectId: 'p-graph' },
    'x'
  );
  t.true(apply(base, filed.update).children('graph').includes(filed.blockId));
});

test('a missing section is made above Inbox: heading, empty to-do, todos: list', t => {
  const base = DAY();
  const filed = fileTaskInJournal(
    base,
    'day',
    { name: 'workflow', projectId: 'p-wf' },
    'CLOUD-150 Add a flag'
  );
  const after = apply(base, filed.update);

  t.true(filed.createdSection);
  const note = after.children('note');
  const inboxAt = note.indexOf('inbox');
  const [heading, list] = note.slice(inboxAt - 2, inboxAt);
  t.is(note.length, 8);
  t.is(after.block(heading).get('prop:type'), 'h2');
  t.is(after.text(heading), 'workflow');

  const [task, empty] = after.children(heading);
  t.is(task, filed.blockId);
  t.is(after.text(task), 'CLOUD-150 Add a flag');
  t.is(after.block(empty).get('prop:type'), 'todo');
  t.is(after.text(empty), '');

  const database = after.block(list);
  t.is(database.get('sys:flavour'), 'notesgraph:database');
  t.is(String(database.get('prop:title')), 'todos:');
  t.is(database.get('prop:queryProjectId'), 'p-wf');
  t.false(database.get('prop:queryNoProject') as boolean);
  const columns = (
    database.get('prop:columns') as Y.Array<Y.Map<unknown>>
  ).toArray();
  t.deepEqual(
    columns.map(c => c.get('name')),
    ['Status', 'Deadline', 'Scheduled']
  );
  const [view] = (
    database.get('prop:views') as Y.Array<Y.Map<unknown>>
  ).toArray();
  t.is(view.get('mode'), 'list');
});

test('Inbox made on a page without it goes last and lists no project', t => {
  const base = journal([h2('work', 'Work', [todo('work-empty')])]);
  const filed = fileTaskInJournal(base, 'day', { name: 'Inbox' }, 'loose end');
  const after = apply(base, filed.update);
  const note = after.children('note');
  t.is(note[0], 'work');
  t.is(after.text(note[1]), 'Inbox');
  t.true(after.block(note[2]).get('prop:queryNoProject') as boolean);
});

test('a heading with nothing under it takes the task as its child', t => {
  const base = journal([h2('work', 'Work')]);
  const filed = fileTaskInJournal(
    base,
    'day',
    { name: 'Work', projectId: 'p' },
    'one'
  );
  t.deepEqual(apply(base, filed.update).children('work'), [filed.blockId]);
});

test('a markdown task line is filed as a to-do of its words', t => {
  t.deepEqual(taskLine('- [ ] Fix it'), { text: 'Fix it', checked: false });
  t.deepEqual(taskLine('[x] Done one'), { text: 'Done one', checked: true });
  t.deepEqual(taskLine('* plain bullet'), {
    text: 'plain bullet',
    checked: false,
  });
  t.deepEqual(taskLine('  QUEUED  KEY-1\nmore '), {
    text: 'QUEUED KEY-1 more',
    checked: false,
  });
  t.throws(() => fileTaskInJournal(DAY(), 'day', { name: 'Work' }, '- [ ] '));
});

test('a doc without a page body is refused', t => {
  const doc = new Y.Doc();
  doc.getMap('blocks').set('x', new Y.Map());
  t.throws(() =>
    fileTaskInJournal(Y.encodeStateAsUpdate(doc), 'day', { name: 'Work' }, 'a')
  );
});

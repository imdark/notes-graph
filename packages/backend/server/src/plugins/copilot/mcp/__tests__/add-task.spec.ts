import test from 'ava';
import * as Y from 'yjs';

import { addTaskUnderHeading, AddTaskError, taskText } from '../add-task';

interface Spec {
  id: string;
  flavour: string;
  type?: string;
  text?: string;
  checked?: boolean;
  children?: Spec[];
}

const h2 = (id: string, text: string, children: Spec[] = []): Spec => ({
  id,
  flavour: 'notesgraph:paragraph',
  type: 'h2',
  text,
  children,
});
const todo = (id: string, text = '', checked = false): Spec => ({
  id,
  flavour: 'notesgraph:list',
  type: 'todo',
  text,
  checked,
});
const todos = (id: string): Spec => ({ id, flavour: 'notesgraph:database' });
const stamp = (id: string, agent: string): Spec => ({
  id,
  flavour: 'notesgraph:paragraph',
  type: 'quote',
  text: `Edited via MCP by ${agent} — 2026-11-25 10:00`,
});

/** A doc whose note holds the given blocks, as the editor stores them. */
function makeDoc(top: Spec[]): Y.Doc {
  const doc = new Y.Doc();
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  const add = (spec: Spec): string => {
    const block = new Y.Map<unknown>();
    const children = new Y.Array<string>();
    block.set('sys:id', spec.id);
    block.set('sys:flavour', spec.flavour);
    block.set('sys:children', children);
    if (spec.type) block.set('prop:type', spec.type);
    if (spec.checked !== undefined) block.set('prop:checked', spec.checked);
    if (spec.text !== undefined) {
      const text = new Y.Text();
      block.set('prop:text', text);
      text.insert(0, spec.text);
    }
    blocks.set(spec.id, block);
    children.push((spec.children ?? []).map(add));
    return spec.id;
  };
  add({ id: 'note', flavour: 'notesgraph:note', children: top });
  return doc;
}

function add(doc: Y.Doc, heading: string, text: string, agent = 'claude') {
  const result = addTaskUnderHeading(Y.encodeStateAsUpdate(doc), {
    heading,
    text,
    agent,
    now: new Date('2026-11-26T09:30:00Z'),
  });
  Y.applyUpdate(doc, result.update);
  return result;
}

const blockOf = (doc: Y.Doc, id: string) =>
  doc.getMap<Y.Map<unknown>>('blocks').get(id)!;
const children = (doc: Y.Doc, id: string) =>
  (blockOf(doc, id).get('sys:children') as Y.Array<string>).toArray();
const textOf = (doc: Y.Doc, id: string) =>
  (blockOf(doc, id).get('prop:text') as Y.Text | undefined)?.toString() ?? '';

/** The app's journal day: each section a heading, its to-do and todos:. */
const journal = () =>
  makeDoc([
    h2('work', 'Work', [todo('work-1')]),
    todos('work-db'),
    h2('ng', 'notes graph', [todo('ng-1')]),
    todos('ng-db'),
    h2('inbox', 'Inbox', [todo('inbox-1')]),
    todos('inbox-db'),
  ]);

test('fills the empty to-do under the heading', t => {
  const doc = journal();
  const result = add(doc, 'notes graph', 'CLOUD-144 Create the to-do');
  t.is(result.blockId, 'ng-1');
  t.is(result.added, 'filled');
  t.false(result.headingCreated);
  t.is(textOf(doc, 'ng-1'), 'CLOUD-144 Create the to-do');
  t.deepEqual(children(doc, 'ng'), ['ng-1']);
});

test('adds a new to-do under the heading once the empty one is used', t => {
  const doc = journal();
  add(doc, 'notes graph', 'first');
  const result = add(doc, 'notes graph', 'second');
  t.is(result.added, 'created');
  t.deepEqual(children(doc, 'ng'), ['ng-1', result.blockId]);
  const block = blockOf(doc, result.blockId);
  t.is(block.get('sys:flavour'), 'notesgraph:list');
  t.is(block.get('prop:type'), 'todo');
  t.false(block.get('prop:checked') as boolean);
  t.is(textOf(doc, result.blockId), 'second');
});

test('leaves the databases and other sections as they were', t => {
  const doc = journal();
  add(doc, 'notes graph', 'first');
  add(doc, 'notes graph', 'second');
  const top = children(doc, 'note');
  t.deepEqual(top.slice(0, 6), [
    'work',
    'work-db',
    'ng',
    'ng-db',
    'inbox',
    'inbox-db',
  ]);
  t.is(textOf(doc, 'work-1'), '');
  t.is(textOf(doc, 'inbox-1'), '');
});

test('a done or written to-do is not reused', t => {
  const doc = makeDoc([
    h2('ng', 'notes graph', [todo('done', '', true), todo('used', 'a task')]),
  ]);
  const result = add(doc, 'notes graph', 'new task');
  t.is(result.added, 'created');
  t.deepEqual(children(doc, 'ng'), ['done', 'used', result.blockId]);
  t.is(textOf(doc, 'used'), 'a task');
});

test('matches the heading as the app matches a project name', t => {
  const doc = journal();
  const result = add(doc, 'Notes-Graph', 'task');
  t.is(result.blockId, 'ng-1');
});

test("to-dos beside the heading (ensure_journal's markdown) are used", t => {
  const doc = makeDoc([
    h2('ng', 'notes graph'),
    todo('beside'),
    h2('inbox', 'Inbox'),
    todo('inbox-1'),
  ]);
  t.is(add(doc, 'notes graph', 'first').blockId, 'beside');
  const second = add(doc, 'notes graph', 'second');
  t.is(second.added, 'created');
  t.deepEqual(children(doc, 'note').slice(0, 4), [
    'ng',
    'beside',
    second.blockId,
    'inbox',
  ]);
});

test('a missing section is added before Inbox, with the to-do under it', t => {
  const doc = journal();
  const result = add(doc, 'robots_realtime', 'task');
  t.true(result.headingCreated);
  const top = children(doc, 'note');
  const heading = top[4];
  t.deepEqual(top.slice(0, 6), [
    'work',
    'work-db',
    'ng',
    'ng-db',
    heading,
    'inbox',
  ]);
  t.is(blockOf(doc, heading).get('prop:type'), 'h2');
  t.is(textOf(doc, heading), 'robots_realtime');
  t.deepEqual(children(doc, heading), [result.blockId]);
  t.is(textOf(doc, result.blockId), 'task');
});

test('without Inbox, a new section goes above the trailing stamp', t => {
  const doc = makeDoc([h2('work', 'Work', [todo('w')]), stamp('s', 'other')]);
  const result = add(doc, 'Ideas', 'task');
  const top = children(doc, 'note');
  t.is(top[1], top.find(id => textOf(doc, id) === 'Ideas'));
  t.deepEqual(children(doc, top[1]), [result.blockId]);
  t.is(top[2], 's');
});

test('stamps the note, refreshing its own stamp instead of stacking', t => {
  const doc = journal();
  add(doc, 'Work', 'one');
  add(doc, 'Work', 'two');
  const top = children(doc, 'note');
  const stamps = top.filter(id =>
    textOf(doc, id).startsWith('Edited via MCP by ')
  );
  t.is(stamps.length, 1);
  t.is(textOf(doc, stamps[0]), 'Edited via MCP by claude — 2026-11-26 09:30');
  t.is(top.at(-1), stamps[0]);
});

test("another agent's stamp is kept and a new one added", t => {
  const doc = makeDoc([h2('work', 'Work', [todo('w')]), stamp('s', 'other')]);
  add(doc, 'Work', 'task');
  const top = children(doc, 'note');
  t.is(top.length, 3);
  t.is(top[1], 's');
  t.true(textOf(doc, top[2]).startsWith('Edited via MCP by claude — '));
});

test('a list marker or empty checkbox in the text is dropped', t => {
  t.is(taskText('- [ ] CLOUD-144 do it'), 'CLOUD-144 do it');
  t.is(taskText('[ ] do it'), 'do it');
  t.is(taskText('[-] doing it'), '[-] doing it');
  const doc = journal();
  add(doc, 'Work', '- [ ] a task');
  t.is(textOf(doc, 'work-1'), 'a task');
});

test('an empty heading or task is refused', t => {
  const binary = Y.encodeStateAsUpdate(journal());
  t.throws(() => addTaskUnderHeading(binary, { heading: ' ', text: 'x' }), {
    instanceOf: AddTaskError,
  });
  t.throws(
    () => addTaskUnderHeading(binary, { heading: 'Work', text: '- [ ] ' }),
    { instanceOf: AddTaskError }
  );
});

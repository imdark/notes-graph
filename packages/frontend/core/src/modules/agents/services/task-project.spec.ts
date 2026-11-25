import { type Store, Text } from '@blocksuite/notesgraph/store';
import { TestWorkspace } from '@blocksuite/notesgraph/store/test';
import { getStoreManager } from '@notesgraph/core/blocksuite/manager/store';
import { beforeEach, describe, expect, test } from 'vitest';

import { projectOf } from './context';
import { moveToProject } from './task-project';

const extensions = getStoreManager().config.init().value.get('store');
const PROJECTS = [
  { id: 'p-work', name: 'Work', docIds: [] },
  { id: 'p-ng', name: 'notes graph', docIds: [] },
];

let store: Store;
let noteId: string;

beforeEach(() => {
  const workspace = new TestWorkspace({ id: 'test' });
  workspace.meta.initialize();
  store = workspace.createDoc('doc').getStore({ extensions });
  store.load();
  const pageId = store.addBlock('notesgraph:page', {
    title: new Text('2026-11-25'),
  });
  noteId = store.addBlock('notesgraph:note', {}, pageId);
});

const heading = (text: string) =>
  store.addBlock(
    'notesgraph:paragraph',
    { type: 'h2', text: new Text(text) },
    noteId
  );
const todo = (text: string, parent = noteId) =>
  store.addBlock(
    'notesgraph:list',
    { type: 'todo', text: new Text(text) },
    parent
  );

/** The note's outline: each top-level block with the lines nested under it. */
const outline = () =>
  store.getModelById(noteId)!.children.map(model =>
    [
      model.text?.toString() ?? '',
      ...model.children.map(c => `  - ${c.text?.toString() ?? ''}`),
    ].join('\n')
  );

const projectIdOf = (id: string) =>
  projectOf(store, 'doc', store.getModelById(id)!, PROJECTS)?.id ?? null;

describe('moveToProject', () => {
  test("a journal task goes under the other project's heading, above its empty to-do", () => {
    const work = heading('Work');
    const task = todo('Cache the build', work);
    todo('', work);
    const ng = heading('notes graph');
    todo('Ship it', ng);
    todo('', ng);

    expect(moveToProject(store, [task], PROJECTS[1])).toBe(true);

    expect(outline()).toEqual([
      'Work\n  - ',
      'notes graph\n  - Ship it\n  - Cache the build\n  - ',
    ]);
    expect(projectIdOf(task)).toBe('p-ng');
  });

  test('a note with no heading for the project gets one at its end', () => {
    const task = todo('Cache the build');
    todo('Next');

    moveToProject(store, [task], PROJECTS[0]);

    expect(outline()).toEqual(['Next', 'Work\n  - Cache the build']);
    expect(projectIdOf(task)).toBe('p-work');
  });

  test("Inbox is the note's Inbox heading when it has one", () => {
    const work = heading('Work');
    const task = todo('Cache the build', work);
    const inbox = heading('Inbox');

    moveToProject(store, [task], null);

    expect(outline()).toEqual(['Work', 'Inbox\n  - Cache the build']);
    expect(store.getParent(task)?.id).toBe(inbox);
    expect(projectIdOf(task)).toBeNull();
  });

  test('without an Inbox heading, Inbox is out of the section, just after it', () => {
    const work = heading('Work');
    const task = todo('Cache the build', work);
    todo('After');

    moveToProject(store, [task], null);

    expect(outline()).toEqual(['Work', 'Cache the build', 'After']);
    expect(projectIdOf(task)).toBeNull();
  });

  test('several blocks keep their order, and a nested one moves with its parent', () => {
    const work = heading('Work');
    const a = todo('A', work);
    const sub = todo('A.1', a);
    const b = todo('B', work);
    heading('notes graph');

    moveToProject(store, [a, sub, b], PROJECTS[1]);

    expect(outline()).toEqual(['Work', 'notes graph\n  - A\n  - B']);
    expect(store.getParent(sub)?.id).toBe(a);
  });

  test('nothing to move without the blocks', () => {
    expect(moveToProject(store, ['gone'], PROJECTS[0])).toBe(false);
  });
});

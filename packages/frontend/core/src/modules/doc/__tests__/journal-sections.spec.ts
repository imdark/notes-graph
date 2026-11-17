import { type Store, Text } from '@blocksuite/notesgraph/store';
import { TestWorkspace } from '@blocksuite/notesgraph/store/test';
import { getStoreManager } from '@notesgraph/core/blocksuite/manager/store';
import { beforeEach, describe, expect, test } from 'vitest';

import { scaffoldJournalSections } from '../utils/journal-sections';

const extensions = getStoreManager().config.init().value.get('store');
const PROJECTS = [
  { id: 'p-work', name: 'Work' },
  { id: 'p-ng', name: 'notes graph' },
];

let store: Store;
let noteId: string;

beforeEach(() => {
  const workspace = new TestWorkspace({ id: 'test' });
  workspace.meta.initialize();
  store = workspace.createDoc('doc').getStore({ extensions });
  store.load();
  const pageId = store.addBlock('notesgraph:page', {
    title: new Text('2026-11-17'),
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

/** The note's outline: headings with their nested lines, lists by scope. */
const outline = () =>
  store.getModelById(noteId)!.children.map(model => {
    if (model.flavour === 'notesgraph:database') {
      const props = model.props as {
        queryProjectId?: string;
        queryNoProject?: boolean;
      };
      return `[todos: ${props.queryNoProject ? 'no project' : props.queryProjectId}]`;
    }
    const nested = model.children.map(c => `  - ${c.text?.toString() ?? ''}`);
    return [`${model.text?.toString() ?? ''}`, ...nested].join('\n');
  });

describe('scaffoldJournalSections', () => {
  test('a new day gets a section per project, then Inbox', () => {
    scaffoldJournalSections(store, noteId, PROJECTS);
    expect(outline()).toEqual([
      'Work\n  - ',
      '[todos: p-work]',
      'notes graph\n  - ',
      '[todos: p-ng]',
      'Inbox\n  - ',
      '[todos: no project]',
    ]);
  });

  test('a page ensure_journal made keeps its lines, nested under their heading', () => {
    // What the server's markdown gives: flat headings and to-dos.
    heading('Work');
    todo('');
    heading('notes graph');
    todo('PERSONAL-296 Cache the build');
    heading('Inbox');
    todo('');

    scaffoldJournalSections(store, noteId, PROJECTS);

    expect(outline()).toEqual([
      'Work\n  - ',
      '[todos: p-work]',
      'notes graph\n  - PERSONAL-296 Cache the build',
      '[todos: p-ng]',
      'Inbox\n  - ',
      '[todos: no project]',
    ]);
  });

  test('an old agent page with one section gets the rest, in project order', () => {
    heading('notes-graph'); // matched loosely, as wf names it
    todo('PERSONAL-1 A task');

    scaffoldJournalSections(store, noteId, PROJECTS);

    expect(outline()).toEqual([
      'Work\n  - ',
      '[todos: p-work]',
      'notes-graph\n  - PERSONAL-1 A task',
      '[todos: p-ng]',
      'Inbox\n  - ',
      '[todos: no project]',
    ]);
  });

  test('running it again adds nothing', () => {
    scaffoldJournalSections(store, noteId, PROJECTS);
    const once = outline();
    scaffoldJournalSections(store, noteId, PROJECTS);
    expect(outline()).toEqual(once);
  });
});

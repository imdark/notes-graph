import { type Store, Text } from '@blocksuite/notesgraph/store';
import { TestWorkspace } from '@blocksuite/notesgraph/store/test';
import { getStoreManager } from '@notesgraph/core/blocksuite/manager/store';
import { beforeEach, describe, expect, test } from 'vitest';

import { insertTasks } from '../utils/insert-tasks';

const extensions = getStoreManager().config.init().value.get('store');

let store: Store;
let noteId: string;

beforeEach(() => {
  const workspace = new TestWorkspace({ id: 'test' });
  workspace.meta.initialize();
  store = workspace.createDoc('doc').getStore({ extensions });
  store.load();
  const pageId = store.addBlock('notesgraph:page', { title: new Text('') });
  noteId = store.addBlock('notesgraph:note', {}, pageId);
});

const line = (text: string, flavour = 'notesgraph:paragraph') =>
  store.addBlock(flavour, { text: new Text(text) }, noteId);

const noteContents = () =>
  store.getModelById(noteId)!.children.map(model => ({
    flavour: model.flavour,
    text: model.text?.toString(),
    type: (model.props as { type?: string }).type,
  }));

describe('insertTasks', () => {
  test('writes unchecked to-dos right after the anchor line', () => {
    const heading = line('Groceries');
    line('After');

    const ids = insertTasks(store, ['Milk', 'Eggs'], heading);

    expect(ids).toHaveLength(2);
    expect(noteContents().map(c => c.text)).toEqual([
      'Groceries',
      'Milk',
      'Eggs',
      'After',
    ]);
    const milk = store.getModelById(ids[0])!;
    expect(milk.flavour).toBe('notesgraph:list');
    expect(milk.props).toMatchObject({ type: 'todo', checked: false });
  });

  test('replaces the empty line the caret was on', () => {
    line('Before');
    const empty = line('');

    insertTasks(store, ['Milk'], empty);

    expect(noteContents().map(c => c.text)).toEqual(['Before', 'Milk']);
    expect(store.getModelById(empty)).toBeNull();
  });

  test('appends to the end of the doc without an anchor', () => {
    line('Existing');

    insertTasks(store, ['Milk'], null);

    expect(noteContents()).toEqual([
      { flavour: 'notesgraph:paragraph', text: 'Existing', type: 'text' },
      { flavour: 'notesgraph:list', text: 'Milk', type: 'todo' },
    ]);
  });

  test('does nothing for no tasks', () => {
    const empty = line('');
    expect(insertTasks(store, [], empty)).toEqual([]);
    expect(store.getModelById(empty)).not.toBeNull();
  });
});

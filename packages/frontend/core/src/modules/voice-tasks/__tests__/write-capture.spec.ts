import { type Store, Text } from '@blocksuite/notesgraph/store';
import { TestWorkspace } from '@blocksuite/notesgraph/store/test';
import { getStoreManager } from '@notesgraph/core/blocksuite/manager/store';
import { beforeEach, describe, expect, test } from 'vitest';

import { writeCapture } from '../utils/write-capture';

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

const lines = () =>
  store.getModelById(noteId)!.children.map(model => model.text?.toString());

describe('writeCapture', () => {
  test('writes one paragraph per non-blank line', () => {
    writeCapture(store, 'Call the plumber\n\n  buy milk  \n');

    expect(lines()).toEqual(['Call the plumber', 'buy milk']);
    expect(store.getModelById(noteId)!.children[0].flavour).toBe(
      'notesgraph:paragraph'
    );
  });

  test('edits lines in place and keeps their blocks', () => {
    writeCapture(store, 'one\ntwo');
    const [first, second] = store.getModelById(noteId)!.children;

    writeCapture(store, 'one\ntwo more\nthree');

    const children = store.getModelById(noteId)!.children;
    expect(lines()).toEqual(['one', 'two more', 'three']);
    expect(children[0]).toBe(first);
    expect(children[1]).toBe(second);
  });

  test('removes lines that were deleted', () => {
    writeCapture(store, 'one\ntwo\nthree');

    writeCapture(store, 'one');

    expect(lines()).toEqual(['one']);
  });
});

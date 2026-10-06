import {
  ColumnBlockSchemaExtension,
  ColumnsBlockSchemaExtension,
  DatabaseBlockSchemaExtension,
  NoteBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
  RootBlockSchemaExtension,
} from '@blocksuite/notesgraph-model';
import {
  insertColumns,
  isNoteLevelContainer,
  removeColumn,
} from '@blocksuite/notesgraph-shared/utils';
import type { BlockModel, Store } from '@blocksuite/store';
import { Text } from '@blocksuite/store';
import {
  createAutoIncrementIdGenerator,
  TestWorkspace,
} from '@blocksuite/store/test';
import { beforeEach, describe, expect, test } from 'vitest';

const extensions = [
  RootBlockSchemaExtension,
  NoteBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
  DatabaseBlockSchemaExtension,
  ColumnsBlockSchemaExtension,
  ColumnBlockSchemaExtension,
];

function createTestDoc() {
  const collection = new TestWorkspace({
    id: 'test-collection',
    idGenerator: createAutoIncrementIdGenerator(),
  });
  collection.meta.initialize();
  const doc = collection.createDoc('doc0');
  doc.load();
  return doc.getStore({ extensions });
}

const text = (store: Store, id: string) =>
  store.getModelById(id)?.text?.toString();

describe('columns layout', () => {
  let store: Store;
  let note: BlockModel;

  beforeEach(() => {
    store = createTestDoc();
    const rootId = store.addBlock('notesgraph:page', {
      title: new Text('dashboard'),
    });
    const noteId = store.addBlock('notesgraph:note', {}, rootId);
    note = store.getModelById(noteId)!;
    store.addBlock('notesgraph:paragraph', { text: new Text('before') }, note);
  });

  test('inserts a row of columns, each with an empty paragraph', () => {
    const paragraphs = insertColumns(store, note, 1, 3);
    expect(paragraphs).toHaveLength(3);
    const row = note.children[1];
    expect(row.flavour).toBe('notesgraph:columns');
    expect(row.children.map(c => c.flavour)).toEqual([
      'notesgraph:column',
      'notesgraph:column',
      'notesgraph:column',
    ]);
    expect(row.children.map(c => c.firstChild()?.id)).toEqual(paragraphs);
  });

  test('a column holds a database like a note does', () => {
    const [first] = insertColumns(store, note, 1, 2);
    const column = store.getParent(first!)!;
    expect(isNoteLevelContainer(column)).toBe(true);
    expect(() =>
      store.addBlock(
        'notesgraph:database',
        { columns: [], titleColumn: 'Title' },
        column
      )
    ).not.toThrow();
  });

  test('removing a column of three keeps the row', () => {
    const [, middle] = insertColumns(store, note, 1, 3);
    const row = note.children[1];
    removeColumn(store, store.getParent(middle!)!);
    expect(row.children).toHaveLength(2);
    expect(note.children[1]).toBe(row);
  });

  test('removing the second-last column unwraps the row in reading order', () => {
    const [left, right] = insertColumns(store, note, 1, 2);
    store.getModelById(left!)!.text!.insert('left', 0);
    store.getModelById(right!)!.text!.insert('right', 0);
    const rightColumn = store.getParent(right!)!;
    store.addBlock(
      'notesgraph:paragraph',
      { text: new Text('left 2') },
      store.getParent(left!)!
    );

    const focus = removeColumn(store, rightColumn);

    expect(note.children.map(b => b.flavour)).toEqual([
      'notesgraph:paragraph',
      'notesgraph:paragraph',
      'notesgraph:paragraph',
    ]);
    expect(note.children.map(b => text(store, b.id))).toEqual([
      'before',
      'left',
      'left 2',
    ]);
    expect(text(store, focus!)).toBe('left 2');
  });
});

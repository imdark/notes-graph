import type { BlockModel, Store } from '@blocksuite/store';

export const COLUMNS_FLAVOUR = 'notesgraph:columns';
export const COLUMN_FLAVOUR = 'notesgraph:column';

/**
 * Whether `model` holds top-level blocks the way a note does: a note, or one
 * column of a row. Blocks that may only sit in a note (databases, tables…)
 * may sit in a column too.
 */
export const isNoteLevelContainer = (model: BlockModel): boolean =>
  model.flavour === 'notesgraph:note' || model.flavour === COLUMN_FLAVOUR;

/**
 * Insert a row of `count` side-by-side columns, each starting with one empty
 * paragraph. Returns the paragraph ids, left to right.
 */
export function insertColumns(
  store: Store,
  parent: BlockModel | string,
  index: number | undefined,
  count: number
): string[] {
  const columnsId = store.addBlock(COLUMNS_FLAVOUR, {}, parent, index);
  return Array.from({ length: count }, () => addColumn(store, columnsId));
}

/** Append a column to a row; returns its (empty) first paragraph's id. */
export function addColumn(store: Store, columns: BlockModel | string): string {
  const columnId = store.addBlock(COLUMN_FLAVOUR, {}, columns);
  return store.addBlock('notesgraph:paragraph', {}, columnId);
}

/**
 * Delete a column. A row left with a single column is unwrapped back into
 * plain blocks — one column is no layout at all. Returns a nearby block to
 * put the cursor in, if there is one.
 */
export function removeColumn(store: Store, column: BlockModel): string | null {
  const columns = store.getParent(column);
  if (!columns || columns.flavour !== COLUMNS_FLAVOUR) return null;
  const siblings = columns.children;
  const index = siblings.indexOf(column);
  const neighbour = siblings[index - 1] ?? siblings[index + 1];
  store.captureSync();
  store.deleteBlock(column);
  const remaining = columns.children;
  if (remaining.length > 1) {
    return neighbour?.lastChild()?.id ?? null;
  }
  return unwrapColumns(store, columns);
}

/**
 * Replace a row with the contents of its columns, in reading order. Returns
 * the last block moved out, if any.
 */
export function unwrapColumns(store: Store, columns: BlockModel): string | null {
  const parent = store.getParent(columns);
  if (!parent) return null;
  const blocks = columns.children.flatMap(column => column.children);
  if (blocks.length) {
    store.moveBlocks(blocks, parent, columns, true);
  }
  store.deleteBlock(columns);
  return blocks[blocks.length - 1]?.id ?? null;
}

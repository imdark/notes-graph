import {
  type BlockModel,
  type Store,
  Text,
} from '@blocksuite/notesgraph/store';

const isEmptyTextLine = (model: BlockModel) =>
  (model.flavour === 'notesgraph:paragraph' ||
    model.flavour === 'notesgraph:list') &&
  model.text?.length === 0;

/**
 * Write `tasks` into `store` as unchecked to-do items and return their ids.
 *
 * With an anchor (the line the caret was on) they go right after it, as its
 * siblings, so tasks dictated under a heading's checklist stay under that
 * heading. An empty anchor line is replaced rather than left as a blank above
 * them (unless it has nested items). Without an anchor they are appended to
 * the end of the last note.
 */
export function insertTasks(
  store: Store,
  tasks: string[],
  anchorBlockId: string | null
): string[] {
  if (tasks.length === 0) return [];

  const anchor = anchorBlockId ? store.getModelById(anchorBlockId) : null;
  const anchorParent = anchor ? store.getParent(anchor) : null;
  const blocks = tasks.map(task => ({
    flavour: 'notesgraph:list',
    blockProps: { type: 'todo', checked: false, text: new Text(task) },
  }));

  let ids: string[] = [];
  store.transact(() => {
    if (anchor && anchorParent && anchor.flavour !== 'notesgraph:note') {
      const index = anchorParent.children.indexOf(anchor) + 1;
      ids = store.addBlocks(blocks, anchorParent, index);
      // An empty line with nested items under it is still holding them up.
      if (isEmptyTextLine(anchor) && anchor.children.length === 0) {
        store.deleteBlock(anchor);
      }
      return;
    }

    const notes = store.getModelsByFlavour('notesgraph:note');
    const note =
      anchor?.flavour === 'notesgraph:note' ? anchor : notes[notes.length - 1];
    if (!note) return;
    ids = store.addBlocks(blocks, note);
  });
  return ids;
}

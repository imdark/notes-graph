import { LayoutIcon } from '@blocksuite/icons/lit';
import { focusTextModel } from '@blocksuite/notesgraph-rich-text';
import {
  insertColumns,
  isInsideBlockByFlavour,
} from '@blocksuite/notesgraph-shared/utils';
import type {
  SlashMenuActionItem,
  SlashMenuContext,
} from '@blocksuite/notesgraph-widget-slash-menu';
import type { BlockModel } from '@blocksuite/store';

/**
 * Put a row of columns right after the block the menu was opened from. A
 * row lives directly in the note, so from inside a column (or a nested list)
 * it goes after the outermost block instead. An empty line the menu was
 * typed into is replaced rather than left behind.
 */
const insertColumnsAt = (
  { std, model }: SlashMenuContext,
  count: number
) => {
  const { store } = model;
  let target: BlockModel = model;
  let parent = store.getParent(target);
  while (parent && parent.flavour !== 'notesgraph:note') {
    target = parent;
    parent = store.getParent(parent);
  }
  if (!parent) return;
  store.captureSync();
  const index = parent.children.indexOf(target);
  const replace =
    target === model &&
    model.flavour === 'notesgraph:paragraph' &&
    !model.text?.length &&
    model.children.length === 0;
  const [first] = insertColumns(store, parent, index + 1, count);
  if (replace) store.deleteBlock(model);
  if (first) focusTextModel(std, first);
};

const columnsItem = (count: number, index: number): SlashMenuActionItem => ({
  name: `${count} Columns`,
  description:
    count === 2
      ? 'Put blocks side by side — build a dashboard.'
      : `${count} blocks side by side.`,
  icon: LayoutIcon(),
  searchAlias: ['columns', 'layout', 'side by side', 'dashboard', 'grid'],
  group: `5_Layout@${index}`,
  when: ({ model }) =>
    model.store.schema.flavourSchemaMap.has('notesgraph:columns') &&
    !isInsideBlockByFlavour(model.store, model, 'notesgraph:edgeless-text'),
  action: context => insertColumnsAt(context, count),
});

export const columnsSlashMenuItems: SlashMenuActionItem[] = [2, 3, 4].map(
  columnsItem
);

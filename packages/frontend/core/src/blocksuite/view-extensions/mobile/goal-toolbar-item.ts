import { FlagPanelIcon } from '@blocksuite/icons/lit';
import { ListBlockModel } from '@blocksuite/notesgraph/model';
import {
  matchModels,
  toggleGoalTag,
} from '@blocksuite/notesgraph/shared/utils';
import { TextSelection } from '@blocksuite/notesgraph/std';
import type { KeyboardToolbarActionItem } from '@blocksuite/notesgraph/widgets/keyboard-toolbar';

/**
 * A flag on the mobile keyboard toolbar that marks the task under the caret
 * as a long-term goal (tags it `#goal`), or back to a task on a second tap.
 * On a bullet or numbered item it makes the item a to-do first.
 */
export const markGoalToolbarItem: KeyboardToolbarActionItem = {
  name: 'Mark as goal',
  icon: FlagPanelIcon(),
  action: ({ std }) => {
    const blockId = std.selection.find(TextSelection)?.from.blockId;
    const model = blockId ? std.store.getBlock(blockId)?.model : null;
    if (!model || !matchModels(model, [ListBlockModel])) return;
    std.store.transact(() => {
      if (model.props.type !== 'todo') {
        std.store.updateBlock(model, { type: 'todo' });
      }
      toggleGoalTag(model.props.text);
    });
  },
};

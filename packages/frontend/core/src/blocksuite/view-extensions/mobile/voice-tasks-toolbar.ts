import { MicrophoneIcon } from '@blocksuite/icons/lit';
import { BlockSelection, TextSelection } from '@blocksuite/notesgraph/std';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import {
  defaultKeyboardToolbarConfig,
  type KeyboardToolbarActionItem,
  KeyboardToolbarConfigExtension,
} from '@blocksuite/notesgraph/widgets/keyboard-toolbar';
import { VoiceTasksService } from '@notesgraph/core/modules/voice-tasks';
import type { FrameworkProvider } from '@notesgraph/infra';

import { lineToolbarItems } from './block-toolbar-items';
import { markGoalToolbarItem } from './goal-toolbar-item';

/**
 * A mic on the mobile keyboard toolbar that opens the dictation sheet, so a
 * batch of tasks can be spoken in right where the caret is. Placed second,
 * after the "+" panel, where it's reachable without scrolling the toolbar,
 * with "Assign to agent" and the "Mark as goal" flag next to it. The toolbar
 * scrolls with no scrollbar, so anything placed after the default items is
 * out of sight. They all live in this one config because only the last
 * keyboard toolbar config registered applies.
 */
export function VoiceTasksKeyboardToolbarExtension(
  framework: FrameworkProvider
): ExtensionType {
  const voiceTasks = framework.get(VoiceTasksService);

  const dictateTasks: KeyboardToolbarActionItem = {
    name: 'Dictate tasks',
    icon: MicrophoneIcon(),
    showWhen: () => voiceTasks.supported,
    action: ({ std }) => {
      const anchorBlockId =
        std.selection.find(TextSelection)?.from.blockId ??
        std.selection.find(BlockSelection)?.blockId ??
        null;
      voiceTasks.open({ docId: std.store.id, anchorBlockId });
    },
  };

  const { assignToAgent, addLineAfter } = lineToolbarItems(framework);
  const [first, ...rest] = defaultKeyboardToolbarConfig.items;
  return KeyboardToolbarConfigExtension({
    items: [
      first,
      dictateTasks,
      assignToAgent,
      markGoalToolbarItem,
      ...rest,
      addLineAfter,
    ],
  });
}

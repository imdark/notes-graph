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

/**
 * A mic on the mobile keyboard toolbar that opens the dictation sheet, so a
 * batch of tasks can be spoken in right where the caret is. Placed second,
 * after the "+" panel, where it's reachable without scrolling the toolbar.
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

  const [first, ...rest] = defaultKeyboardToolbarConfig.items;
  return KeyboardToolbarConfigExtension({
    items: [first, dictateTasks, ...rest],
  });
}

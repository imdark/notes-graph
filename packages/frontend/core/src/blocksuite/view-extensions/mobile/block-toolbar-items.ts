import { AiIcon } from '@blocksuite/icons/lit';
import { EnterIcon } from '@blocksuite/notesgraph/components/icons';
import { type BlockStdScope, TextSelection } from '@blocksuite/notesgraph/std';
import type { BlockModel } from '@blocksuite/notesgraph/store';
import type { KeyboardToolbarActionItem } from '@blocksuite/notesgraph/widgets/keyboard-toolbar';
import {
  addRowAfterAndFocus,
  blockTarget,
  openAssignToAgentMenu,
} from '@notesgraph/core/blocksuite/view-extensions/agents/block-actions';
import {
  AgentRunSessionService,
  isOpenTask,
  isPlainBlock,
} from '@notesgraph/core/modules/agents';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import type { FrameworkProvider } from '@notesgraph/infra';

/** The lines the assign pill and add-row pill live on. */
const LINE_FLAVOURS = new Set(['notesgraph:paragraph', 'notesgraph:list']);

/** The paragraph or list item the caret is in, if it is in one. */
function caretLine(std: BlockStdScope): BlockModel | null {
  const blockId = std.selection.find(TextSelection)?.from.blockId;
  const model = blockId ? std.store.getBlock(blockId)?.model : null;
  return model && LINE_FLAVOURS.has(model.flavour) ? model : null;
}

/**
 * The block's own line, for the agent menu to open against: it stays in
 * view above the keyboard, where the toolbar button would sit under it.
 */
function lineAnchor(std: BlockStdScope, model: BlockModel): HTMLElement | null {
  const block = std.view.getBlock(model.id);
  return block?.querySelector<HTMLElement>('rich-text') ?? block ?? null;
}

/**
 * The line's two pills (assign to an agent, add a row after) as keyboard
 * toolbar buttons, at the end of the toolbar, so they're reachable with the
 * keyboard up. Behind enable_mobile_toolbar_line_actions.
 */
export function lineToolbarItems(
  framework: FrameworkProvider
): KeyboardToolbarActionItem[] {
  const on = () =>
    !!framework.get(FeatureFlagService).flags
      .enable_mobile_toolbar_line_actions.value;

  const assignToAgent: KeyboardToolbarActionItem = {
    name: 'Assign to agent',
    icon: AiIcon(),
    showWhen: on,
    // The blocks the line's own pill is offered on: an open task, or a
    // plain line, that no agent is already working on.
    disableWhen: ({ std }) => {
      const model = caretLine(std);
      if (!model || std.store.readonly) return true;
      if (!isOpenTask(model) && !isPlainBlock(model)) return true;
      return framework
        .get(AgentRunSessionService)
        .isBusyOn(blockTarget(std, model));
    },
    action: ({ std }) => {
      const model = caretLine(std);
      const anchor = model ? lineAnchor(std, model) : null;
      if (!model || !anchor) return;
      openAssignToAgentMenu({ framework, std, model, anchor });
    },
  };

  const addLineAfter: KeyboardToolbarActionItem = {
    name: 'Add a line after',
    icon: EnterIcon,
    showWhen: on,
    disableWhen: ({ std }) => !caretLine(std) || std.store.readonly,
    action: ({ std }) => {
      const model = caretLine(std);
      if (model) addRowAfterAndFocus(std, model);
    },
  };

  return [assignToAgent, addLineAfter];
}

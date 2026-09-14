import { ToolIcon } from '@blocksuite/icons/lit';
import { BlockSelection, TextSelection } from '@blocksuite/notesgraph/std';
import {
  SlashMenuConfigExtension,
  type SlashMenuContext,
  type SlashMenuItem,
} from '@blocksuite/notesgraph/widgets/slash-menu';
import {
  type Agent,
  AgentRunSessionService,
  AgentsService,
  type AgentTarget,
} from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import type { FrameworkProvider } from '@notesgraph/infra';
import { html } from 'lit';

const GROUP = '2_Agents@0';

/** The block the caret is in, which is what `/` was typed into. */
const currentBlockId = (ctx: SlashMenuContext): string | null => {
  const text = ctx.std.selection.find(TextSelection);
  if (text?.from.blockId) return text.from.blockId;
  const blocks = ctx.std.selection.filter(BlockSelection);
  return blocks[0]?.blockId ?? null;
};

const selectedBlockIds = (ctx: SlashMenuContext): string[] => {
  return ctx.std.selection.filter(BlockSelection).map(sel => sel.blockId);
};

/**
 * Adds each agent that can run on a block to the slash menu.
 *
 * The menu closes the instant an item is chosen, so there's nowhere here to
 * show a result: the action starts the run in AgentRunSessionService and opens
 * the Agents side panel, which renders it. Nothing is written to the note —
 * phase 1 output is read-and-copy.
 */
export function AgentsSlashMenuConfigExtension(framework: FrameworkProvider) {
  return SlashMenuConfigExtension('notesgraph-agents', {
    items: (ctx: SlashMenuContext): SlashMenuItem[] => {
      let agents: Agent[] = [];
      try {
        agents = framework.get(AgentsService).agentsFor$('block').value;
      } catch {
        // No workspace scope (e.g. a detached editor) — offer nothing rather
        // than breaking the whole slash menu.
        return [];
      }
      if (agents.length === 0) return [];

      return agents.map<SlashMenuItem>(agent => ({
        name: agent.name,
        description: 'Run this agent on the current block',
        icon: html`<div style="color: var(--notesgraph-primary-color)">
          ${agent.emoji ? html`<span>${agent.emoji}</span>` : ToolIcon()}
        </div>`,
        searchAlias: ['agent'],
        group: GROUP,
        when: () => currentBlockId(ctx) !== null,
        action: () => {
          const blockIds = selectedBlockIds(ctx);
          const blockId = currentBlockId(ctx);
          if (!blockId) return;
          const docId = ctx.std.host.store.id;

          // More than one block highlighted reads as "run on all of them",
          // which is a different target than the caret's block.
          const target: AgentTarget =
            blockIds.length > 1
              ? { kind: 'selection', docId, blockIds }
              : { kind: 'block', docId, blockId };

          const workbench = framework.get(WorkbenchService).workbench;
          workbench.openSidebar();
          workbench.activeView$.value.activeSidebarTab('agents');
          void framework.get(AgentRunSessionService).start(agent, target);
        },
      }));
    },
  });
}

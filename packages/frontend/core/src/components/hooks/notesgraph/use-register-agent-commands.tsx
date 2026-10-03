import { ToolIcon } from '@blocksuite/icons/rc';
import { getSelectedModelsCommand } from '@blocksuite/notesgraph/shared/commands';
import {
  BlockSelection,
  type BlockStdScope,
  TextSelection,
} from '@blocksuite/notesgraph/std';
import { registerNotesGraphCommand } from '@notesgraph/core/commands';
import {
  AgentRunSessionService,
  AgentsService,
  type AgentTarget,
} from '@notesgraph/core/modules/agents';
import type { Editor } from '@notesgraph/core/modules/editor';
import { QuickSearchService } from '@notesgraph/core/modules/quicksearch';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useEffect } from 'react';

/**
 * The blocks the palette should run an agent on, captured when it opens —
 * the palette's input steals focus and collapses the caret. Unlike the
 * selection-edit commands, a collapsed caret counts: it names its block,
 * the same way the `/` menu does.
 */
let paletteTarget: { blockIds: string[] } = { blockIds: [] };

const targetBlockIds = (s: BlockStdScope): string[] => {
  const text = s.selection.find(TextSelection);
  if (text?.isCollapsed()) return [text.from.blockId];
  if (!text && s.selection.filter(BlockSelection).length === 0) return [];
  const [, ctx] = s.command
    .chain()
    .pipe(getSelectedModelsCommand, { types: ['block', 'text'] })
    .run();
  return ctx.selectedModels?.map(model => model.id) ?? [];
};

/**
 * Every agent that runs on a block, offered in the Cmd/Ctrl+K palette
 * ("Run agent: …") while the caret or a selection is in the page editor —
 * the palette counterpart of the agents in the `/` menu.
 */
export function useRegisterAgentCommands(editor: Editor, active: boolean) {
  const quickSearch = useService(QuickSearchService).quickSearch;
  const agentsService = useService(AgentsService);
  const sessions = useService(AgentRunSessionService);
  const workbench = useService(WorkbenchService).workbench;
  const agents = useLiveData(agentsService.agentsFor$('block'));

  useEffect(() => {
    if (!active || agents.length === 0) return;

    const showSubscription = quickSearch.show$.subscribe(show => {
      if (!show) return;
      const s = editor.editorContainer$.value?.host?.std;
      paletteTarget = { blockIds: s ? targetBlockIds(s) : [] };
    });

    const unsubs: Array<() => void> = [() => showSubscription.unsubscribe()];

    for (const agent of agents) {
      unsubs.push(
        registerNotesGraphCommand({
          id: `editor:selection-run-agent-${agent.id}`,
          preconditionStrategy: () => paletteTarget.blockIds.length > 0,
          category: 'editor:selection',
          icon: agent.emoji ? <span>{agent.emoji}</span> : <ToolIcon />,
          label: `Run agent: ${agent.name}`,
          run: () => {
            const docId = editor.doc.id;
            const [first, ...rest] = paletteTarget.blockIds;
            if (!first) return;
            const target: AgentTarget =
              rest.length > 0
                ? {
                    kind: 'selection',
                    docId,
                    blockIds: paletteTarget.blockIds,
                  }
                : { kind: 'block', docId, blockId: first };
            workbench.openSidebar();
            workbench.activeView$.value.activeSidebarTab('agents');
            void sessions.start(agent, target);
          },
        })
      );
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [editor, active, agents, quickSearch, sessions, workbench]);
}

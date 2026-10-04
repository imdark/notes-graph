import { notify } from '@notesgraph/component';
import {
  type AgentRun,
  AgentRunSessionService,
  AgentRunsStore,
  AgentsService,
} from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useService } from '@notesgraph/infra';
import { useCallback } from 'react';

/**
 * Run-again and delete for a run in a list.
 *
 * Run again starts the same agent on the same target and shows it in that
 * note's Agents panel — the one place a run's output is shown — so from
 * anywhere but that note it opens the note first.
 */
export const useRunActions = ({ openDoc }: { openDoc: boolean }) => {
  const agentsService = useService(AgentsService);
  const sessionService = useService(AgentRunSessionService);
  const runsStore = useService(AgentRunsStore);
  const workbench = useService(WorkbenchService).workbench;

  const retry = useCallback(
    (run: AgentRun) => {
      const agent = agentsService.agents$.value.find(
        ({ id }) => id === run.agentId
      );
      if (!agent) {
        notify.error({
          title: "Can't run it again",
          message: `${run.agentName} has been deleted.`,
        });
        return;
      }
      const target = runsStore.targetOf(run);
      if (!target) {
        notify.error({
          title: "Can't run it again",
          message:
            "Which blocks it ran on wasn't recorded. Select them and run the agent with Ctrl/⌘ K.",
        });
        return;
      }
      // Starting a run replaces the current one, which would stop it unasked.
      if (sessionService.session$.value?.running) {
        notify.error({
          title: 'Another run is going',
          message: 'Stop it or wait for it to finish first.',
        });
        return;
      }
      if (openDoc) workbench.openDoc(run.docId, { at: 'active' });
      workbench.openSidebar();
      workbench.activeView$.value.activeSidebarTab('agents');
      void sessionService.start(agent, target);
    },
    [agentsService, openDoc, runsStore, sessionService, workbench]
  );

  const remove = useCallback(
    (run: AgentRun) => runsStore.delete([run.id]),
    [runsStore]
  );

  return { retry, remove };
};

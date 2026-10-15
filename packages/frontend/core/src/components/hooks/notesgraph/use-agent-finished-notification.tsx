import { notify } from '@notesgraph/component';
import { AgentRunSessionService } from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useService } from '@notesgraph/infra';
import { useEffect } from 'react';

/** How much of the agent's answer the notification shows. */
const PREVIEW_CHARS = 280;

/**
 * Tells the reader when an agent run has ended, with what it said, so they can
 * keep its work, read the whole run and ask the agent more, or undo it.
 */
export function useAgentFinishedNotification(active: boolean) {
  const sessions = useService(AgentRunSessionService);
  const workbench = useService(WorkbenchService).workbench;

  useEffect(() => {
    if (!active) return;
    const subscription = sessions.finished$.subscribe(done => {
      const text = done.output.trim();
      // The Agents tab is registered by a note's page, so from any other view
      // there is nothing to switch to; open the note the run was on first.
      const open = () => {
        workbench.openDoc(done.docId, { at: 'active' });
        workbench.openSidebar();
        workbench.activeView$.value.activeSidebarTab('agents');
      };
      const show = done.failed ? notify.error : notify.success;
      show({
        title: done.failed
          ? `${done.agentName} hit an error`
          : `${done.agentName} finished`,
        message: [
          done.targetLabel,
          text.length > PREVIEW_CHARS
            ? `${text.slice(0, PREVIEW_CHARS - 1)}…`
            : text,
        ]
          .filter(Boolean)
          .join('\n'),
        actions: [
          {
            key: 'keep',
            label: 'Keep',
            onClick: () => sessions.keep(done.sessionId),
          },
          {
            key: 'review',
            label: 'Review or ask',
            onClick: open,
            autoClose: true,
          },
          ...(done.undoable
            ? [
                {
                  key: 'undo',
                  label: 'Undo',
                  onClick: async () => {
                    const undone = await sessions.undo(done.sessionId);
                    if (!undone) {
                      notify.error({ title: 'Could not undo this run' });
                    }
                  },
                },
              ]
            : []),
        ],
      });
    });
    return () => subscription.unsubscribe();
  }, [active, sessions, workbench]);
}

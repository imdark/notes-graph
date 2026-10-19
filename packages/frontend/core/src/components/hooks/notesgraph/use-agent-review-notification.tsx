import { notify } from '@notesgraph/component';
import {
  type AgentRun,
  AgentRunSessionService,
  AgentRunsStore,
} from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useService } from '@notesgraph/infra';
import { useEffect } from 'react';

/** How much of the run's result the notification shows. */
const PREVIEW_CHARS = 280;

/**
 * Runs that ended longer ago than this are already waiting when the app
 * opens; their cards are there, but they don't announce themselves again.
 */
const FRESH_MS = 2 * 60_000;

/** The toast stays a while; the card on the Agents page stays until approved. */
const TOAST_MS = 20_000;

const endedAt = (run: AgentRun) => run.startedAt + (run.durationMs ?? 0);

/** A system notification, for when the app isn't the window in front. */
function notifySystem(run: AgentRun, onClick: () => void) {
  if (typeof Notification === 'undefined' || document.hasFocus()) return;
  const show = () => {
    const note = new Notification(`${run.agentName} is done — review it`, {
      body: run.summary ?? run.title ?? '',
      tag: `agent-review-${run.id}`,
    });
    note.onclick = () => {
      window.focus();
      onClick();
      note.close();
    };
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission === 'default') {
    Notification.requestPermission()
      .then(permission => permission === 'granted' && show())
      .catch(() => {});
  }
}

/**
 * Tells the reader when a run finishes and waits for them, wherever they are
 * in the app and whichever device ran it: the flag is on the run's synced row,
 * so a run on a device or in the cloud announces itself here too.
 */
export function useAgentReviewNotification() {
  const runsStore = useService(AgentRunsStore);
  const sessions = useService(AgentRunSessionService);
  const workbench = useService(WorkbenchService).workbench;

  useEffect(() => {
    const announced = new Set<string>();
    const subscription = runsStore.watchPendingReview().subscribe(runs => {
      for (const run of runs) {
        if (announced.has(run.id)) continue;
        announced.add(run.id);
        if (Date.now() - endedAt(run) > FRESH_MS) continue;

        // The Agents page lists it under "Needs you" with Approve, Review
        // changes and Ask.
        const review = () => workbench.open('/agents');
        const approve = () => {
          runsStore.settleReview(run.id);
          const session = sessions.sessions$.value.find(
            s => s.runId === run.id
          );
          if (session) sessions.keep(session.id);
        };
        const text = (run.summary ?? '').trim();
        notify.success(
          {
            title: `${run.agentName} is done — review it`,
            message: [
              run.title,
              text.length > PREVIEW_CHARS
                ? `${text.slice(0, PREVIEW_CHARS - 1)}…`
                : text,
            ]
              .filter(Boolean)
              .join('\n'),
            actions: [
              {
                key: 'approve',
                label: 'Approve',
                onClick: approve,
                autoClose: true,
              },
              {
                key: 'review',
                label: 'Review',
                onClick: review,
                autoClose: true,
              },
            ],
          },
          { duration: TOAST_MS }
        );
        notifySystem(run, review);
      }
    });
    return () => subscription.unsubscribe();
  }, [runsStore, sessions, workbench]);
}

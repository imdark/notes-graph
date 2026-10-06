import { Button, notify, useThemeColorV2 } from '@notesgraph/component';
import { AgentQuestionCard } from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/agent-question';
import { AgentRunLogDialog } from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/agent-run-log';
import {
  RunRow,
  useMinuteTick,
} from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/agent-run-row';
import { SessionCard } from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/agents';
import * as panelStyles from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/agents.css';
import {
  displayStatus,
  useRemoteRunStates,
} from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/use-run-questions';
import { useRunActions } from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/use-run-actions';
import {
  type AgentRun,
  AgentRunSessionService,
  AgentRunsStore,
  AgentsService,
} from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

import { PageHeader } from '../../components';
import { Page } from '../../components/page';
import * as styles from './agents.css';

/** Runs listed before "Show more". */
const PAGE_SIZE = 20;

/**
 * The phone's agent runs: what is going now, what is waiting on an answer,
 * and the run history. The desktop shows these in a note's side panel and
 * on the Agents page; the phone has neither, so a to-do assigned from it
 * would otherwise run out of sight.
 */
const AgentRuns = () => {
  const sessionService = useService(AgentRunSessionService);
  const agentsService = useService(AgentsService);
  const runsStore = useService(AgentRunsStore);
  const workbench = useService(WorkbenchService).workbench;
  const now = useMinuteTick();
  // Run again and delete come from here; run again stays on this page, which
  // shows the new run at the top, rather than opening a side panel the phone
  // doesn't have.
  const { remove, showTarget, showRunTarget } = useRunActions({
    openDoc: true,
  });

  const sessions = useLiveData(sessionService.sessions$);
  const queue = useLiveData(sessionService.queue$);
  const runs = useLiveData(useMemo(() => runsStore.watchRuns(), [runsStore]));
  const remote = useRemoteRunStates(runs);

  const [limit, setLimit] = useState(PAGE_SIZE);
  const [logRunId, setLogRunId] = useState<string | null>(null);
  const closeLog = useCallback(() => setLogRunId(null), []);

  const openDoc = useCallback(
    (docId: string) => workbench.openDoc(docId, { at: 'active' }),
    [workbench]
  );

  const retry = useCallback(
    (run: AgentRun) => {
      const agent = agentsService.agents$.value.find(
        ({ id }) => id === run.agentId
      );
      const target = agent ? runsStore.targetOf(run) : null;
      if (!agent || !target) {
        notify.error({
          title: "Can't run it again",
          message: agent
            ? "Which blocks it ran on wasn't recorded."
            : `${run.agentName} has been deleted.`,
        });
        return;
      }
      void sessionService.start(agent, target);
    },
    [agentsService, runsStore, sessionService]
  );

  // A run going in this app is shown by its live card above, so the history
  // skips it rather than listing it twice.
  const live = useMemo(
    () =>
      new Set(
        sessions.flatMap(session => (session.runId ? [session.runId] : []))
      ),
    [sessions]
  );
  const history = useMemo(
    () => runs.filter(run => !live.has(run.id)),
    [runs, live]
  );

  // Questions block a run, so they lead the page.
  const waiting = useMemo(
    () =>
      history.filter(
        run =>
          run.remoteJobId && (remote.get(run.id)?.questions.length ?? 0) > 0
      ),
    [history, remote]
  );

  const runningCount = sessions.filter(session => session.running).length;

  return (
    <div className={styles.scroll}>
      <div className={styles.body} data-testid="mobile-agent-runs">
        {waiting.length > 0 ? (
          <section className={styles.section}>
            <div className={styles.sectionTitle}>
              Needs you ({waiting.length})
            </div>
            {waiting.map(run => (
              <div key={run.id} className={styles.waitingCard}>
                <div className={panelStyles.runList}>
                  <RunRow
                    run={run}
                    status="waiting"
                    now={now}
                    onOpen={setLogRunId}
                    onOpenDoc={openDoc}
                    onShowTarget={showRunTarget}
                  />
                </div>
                {remote.get(run.id)?.questions.map(question => (
                  <AgentQuestionCard
                    key={question.id}
                    jobId={run.remoteJobId as string}
                    question={question}
                  />
                ))}
              </div>
            ))}
          </section>
        ) : null}

        {sessions.length > 0 ? (
          <section className={styles.section}>
            <div className={styles.sectionTitle}>
              On this device
              {runningCount > 1 ? (
                <Button
                  variant="plain"
                  onClick={() => sessionService.cancelAll()}
                  data-testid="cancel-all-agents"
                >
                  Stop all
                </Button>
              ) : null}
            </div>
            {sessions
              .slice()
              .reverse()
              .map(session => (
                <SessionCard
                  key={session.id}
                  session={session}
                  queued={session.onDevice ? queue.length : 0}
                  onViewLog={setLogRunId}
                  onShowTarget={showTarget}
                />
              ))}
          </section>
        ) : null}

        {queue.length > 0 ? (
          <section className={styles.section} data-testid="agent-queue">
            <div className={styles.sectionTitle}>Up next ({queue.length})</div>
            <div className={panelStyles.runList}>
              {queue.map(run => (
                <div
                  key={run.id}
                  className={panelStyles.panelFooter}
                  data-testid="agent-queue-item"
                >
                  <span>
                    {run.agent.emoji ? `${run.agent.emoji} ` : ''}
                    {run.agent.name} · {run.targetLabel}
                  </span>
                  <button
                    className={panelStyles.linkButton}
                    onClick={() => sessionService.dequeue(run.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className={styles.section}>
          <div className={styles.sectionTitle}>Runs</div>
          {history.length === 0 ? (
            <p className={styles.empty}>
              {sessions.length === 0
                ? 'Nothing has run yet. Tap the agent button at the end of a to-do to hand it to an agent; its run shows up here.'
                : 'No earlier runs.'}
            </p>
          ) : (
            <div className={panelStyles.runList} data-testid="agents-page-runs">
              {history.slice(0, limit).map(run => (
                <RunRow
                  key={run.id}
                  run={run}
                  status={displayStatus(run, remote.get(run.id))}
                  now={now}
                  onOpen={setLogRunId}
                  onOpenDoc={openDoc}
                  onShowTarget={showRunTarget}
                  onRetry={retry}
                  onDelete={remove}
                />
              ))}
            </div>
          )}
          {history.length > limit ? (
            <Button
              variant="plain"
              onClick={() => setLimit(prev => prev + PAGE_SIZE)}
            >
              Show more ({history.length - limit})
            </Button>
          ) : null}
        </section>
      </div>
      <AgentRunLogDialog runId={logRunId} onClose={closeLog} />
    </div>
  );
};

export const Component = () => {
  useThemeColorV2('layer/background/mobile/primary');

  return (
    <Page
      header={
        <PageHeader>
          <span className={styles.title}>Agents</span>
        </PageHeader>
      }
      tab
    >
      <AgentRuns />
    </Page>
  );
};

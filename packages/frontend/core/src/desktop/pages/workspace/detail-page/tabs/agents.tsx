import { PlusIcon } from '@blocksuite/icons/rc';
import { Button, notify, Scrollable } from '@notesgraph/component';
import {
  type Agent,
  AgentIcon,
  AgentRunSessionService,
  AgentRunsStore,
  AgentsService,
} from '@notesgraph/core/modules/agents';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { DocService } from '@notesgraph/core/modules/doc';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

import { AgentQuestionCard } from './agent-question';
import { AgentRunLogDialog } from './agent-run-log';
import { RunRow, RunStatusBadge, useMinuteTick } from './agent-run-row';
import * as styles from './agents.css';
import { useRunActions } from './use-run-actions';

/** Recent runs shown here; the Agents page has the rest. */
const PANEL_RUNS = 8;

export const EditorAgentsPanel = () => {
  const agentsService = useService(AgentsService);
  const sessionService = useService(AgentRunSessionService);
  const runsStore = useService(AgentRunsStore);
  const dialogService = useService(WorkspaceDialogService);
  const workbench = useService(WorkbenchService).workbench;
  const doc = useService(DocService).doc;
  const now = useMinuteTick();

  const docAgents = useLiveData(agentsService.agentsFor$('doc'));
  const allAgents = useLiveData(agentsService.agents$);
  const session = useLiveData(sessionService.session$);
  const queue = useLiveData(sessionService.queue$);
  const runs = useLiveData(
    useMemo(() => runsStore.watchRunsForDoc(doc.id), [runsStore, doc.id])
  );

  const runOnDoc = useCallback(
    (agent: Agent) => {
      void sessionService.start(agent, { kind: 'doc', docId: doc.id });
    },
    [doc.id, sessionService]
  );

  const running = session?.running ?? false;
  const runActions = useRunActions({ openDoc: false });
  const [logRunId, setLogRunId] = useState<string | null>(null);
  const closeLog = useCallback(() => setLogRunId(null), []);

  // The panel is where someone realises they want an agent, so it has to be
  // able to get them there rather than naming a screen they have to go find.
  const openAgentSettings = useCallback(() => {
    dialogService.open('setting', { activeTab: 'workspace:agents' });
  }, [dialogService]);
  const openAgentsPage = useCallback(() => {
    workbench.open('/agents');
  }, [workbench]);

  const copyOutput = useCallback(() => {
    if (!session?.output) return;
    navigator.clipboard
      .writeText(session.output)
      .then(() => notify.success({ title: 'Copied' }))
      .catch(() => notify.error({ title: "Couldn't copy" }));
  }, [session?.output]);

  const sessionStatus = !session
    ? null
    : running
      ? session.questions.length > 0
        ? 'waiting'
        : 'running'
      : session.error
        ? 'error'
        : 'done';

  return (
    <Scrollable.Root className={styles.root}>
      <Scrollable.Viewport>
        <div className={styles.body}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Run on this note</span>
            {docAgents.length === 0 ? (
              <p className={styles.empty}>
                {allAgents.length === 0
                  ? 'You have no agents yet. An agent is a saved instruction — "summarise this", "find open questions" — that you can run on a note.'
                  : 'None of your agents run on a whole note. Turn on "note" for one in its settings, or run one on a block from the editor.'}
              </p>
            ) : (
              <div className={styles.agentList}>
                {docAgents.map(agent => (
                  <button
                    key={agent.id}
                    className={styles.agentButton}
                    onClick={() => runOnDoc(agent)}
                    data-testid="run-agent"
                    title={
                      running
                        ? `Queue ${agent.name} after the current run`
                        : `Run ${agent.name}`
                    }
                  >
                    <span className={styles.agentEmoji}>
                      <AgentIcon agent={agent} />
                    </span>
                    <span className={styles.agentName}>{agent.name}</span>
                    {running && session?.agentId === agent.id ? (
                      <RunStatusBadge status="running" />
                    ) : null}
                  </button>
                ))}
              </div>
            )}
            <Button
              variant={allAgents.length === 0 ? 'primary' : 'secondary'}
              onClick={openAgentSettings}
              data-testid="panel-new-agent"
              prefix={<PlusIcon />}
            >
              New agent
            </Button>
            <span className={styles.hint}>
              To run one on a block or a selection, press <code>Ctrl/⌘ K</code>{' '}
              (or type <code>/</code>) in the editor and pick it there.
            </span>
          </div>

          {session && sessionStatus ? (
            <div className={styles.section} data-testid="agent-session">
              <div className={styles.panelFooter}>
                <span className={styles.sectionLabel}>
                  {session.agentName} · {session.targetLabel}
                </span>
                <RunStatusBadge status={sessionStatus} />
              </div>

              {session.remoteJobId
                ? session.questions.map(question => (
                    <AgentQuestionCard
                      key={question.id}
                      jobId={session.remoteJobId as string}
                      question={question}
                    />
                  ))
                : null}

              {session.error ? (
                <p className={styles.error} data-testid="agent-error">
                  {session.error}
                </p>
              ) : session.output ? (
                <p className={styles.output} data-testid="agent-output">
                  {session.output}
                </p>
              ) : (
                <p className={styles.empty}>
                  {!running
                    ? 'It finished without an answer. The log shows what it did.'
                    : session.questions.length > 0
                      ? 'Waiting for you…'
                      : 'Working…'}
                </p>
              )}

              <div className={styles.sessionActions}>
                {running ? (
                  <>
                    <Button
                      onClick={() => sessionService.cancel()}
                      data-testid="cancel-agent"
                      title={
                        queue.length > 0
                          ? 'Stop this run; the next queued one starts'
                          : undefined
                      }
                    >
                      Stop
                    </Button>
                    {queue.length > 0 ? (
                      <Button
                        onClick={() => sessionService.cancelAll()}
                        data-testid="cancel-all-agents"
                      >
                        Stop all
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <>
                    {session.output ? (
                      <Button
                        variant="primary"
                        onClick={copyOutput}
                        data-testid="copy-agent-output"
                      >
                        Copy answer
                      </Button>
                    ) : null}
                    <Button onClick={() => sessionService.clear()}>
                      Dismiss
                    </Button>
                  </>
                )}
                {session.runId ? (
                  <Button
                    variant="plain"
                    onClick={() => setLogRunId(session.runId)}
                    data-testid="view-agent-log"
                  >
                    View log
                  </Button>
                ) : null}
              </div>

              {!running && session.output ? (
                <span className={styles.hint}>
                  Nothing is written to the note — copy what you want to keep.
                </span>
              ) : null}
            </div>
          ) : null}

          {queue.length > 0 ? (
            <div className={styles.section} data-testid="agent-queue">
              <span className={styles.sectionLabel}>
                Up next ({queue.length})
              </span>
              <div className={styles.runList}>
                {queue.map(run => (
                  <div
                    key={run.id}
                    className={styles.panelFooter}
                    data-testid="agent-queue-item"
                  >
                    <span>
                      {run.agent.emoji ? `${run.agent.emoji} ` : ''}
                      {run.agent.name} · {run.targetLabel}
                    </span>
                    <button
                      className={styles.linkButton}
                      onClick={() => sessionService.dequeue(run.id)}
                      data-testid="agent-queue-remove"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className={styles.section}>
            <div className={styles.panelFooter}>
              <span className={styles.sectionLabel}>Recent runs here</span>
              <button
                className={styles.linkButton}
                onClick={openAgentsPage}
                data-testid="open-agents-page"
              >
                All runs →
              </button>
            </div>
            {runs.length === 0 ? (
              <p className={styles.empty}>No agent has run on this note yet.</p>
            ) : (
              <div className={styles.runList}>
                {runs.slice(0, PANEL_RUNS).map(run => (
                  <RunRow
                    key={run.id}
                    run={run}
                    now={now}
                    onOpen={setLogRunId}
                    onRetry={running ? undefined : runActions.retry}
                    onDelete={runActions.remove}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </Scrollable.Viewport>
      <Scrollable.Scrollbar />
      <AgentRunLogDialog runId={logRunId} onClose={closeLog} />
    </Scrollable.Root>
  );
};

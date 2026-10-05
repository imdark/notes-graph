import { PlusIcon } from '@blocksuite/icons/rc';
import { Button, notify, Scrollable } from '@notesgraph/component';
import {
  type Agent,
  AgentIcon,
  type AgentRunSession,
  AgentRunSessionService,
  AgentRunsStore,
  AgentsService,
  agentTargetBlockIds,
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

/** One run going, or finished and not yet dismissed. */
const SessionCard = ({
  session,
  queued,
  onViewLog,
  onShowTarget,
}: {
  session: AgentRunSession;
  /** How many on-device runs wait for this one, when it is on-device. */
  queued: number;
  onViewLog: (runId: string) => void;
  onShowTarget: (target: AgentRunSession['target']) => void;
}) => {
  const sessionService = useService(AgentRunSessionService);
  const { running } = session;
  // A worker's result is the note it changed; what it says at the end is a
  // report on that, so there's no answer to copy.
  const answers = session.agentKind === 'answer';

  const copyOutput = useCallback(() => {
    if (!session.output) return;
    navigator.clipboard
      .writeText(session.output)
      .then(() => notify.success({ title: 'Copied' }))
      .catch(() => notify.error({ title: "Couldn't copy" }));
  }, [session.output]);

  const status = running
    ? session.questions.length > 0
      ? 'waiting'
      : 'running'
    : session.error
      ? 'error'
      : 'done';

  return (
    <div className={styles.section} data-testid="agent-session">
      <div className={styles.panelFooter}>
        <span className={styles.sectionLabel} title={session.agentName}>
          {session.targetLabel}
        </span>
        <span className={styles.sessionHeadSide}>
          {session.focus || agentTargetBlockIds(session.target).length > 0 ? (
            <button
              className={styles.linkButton}
              // Working down a list, the agent moves from block to block, so
              // go to the one it is on (or last touched), else the run's own.
              onClick={() =>
                onShowTarget(
                  session.focus
                    ? {
                        kind: 'block',
                        docId: session.focus.docId,
                        blockId: session.focus.blockId,
                      }
                    : session.target
                )
              }
              title={
                running
                  ? 'Go to the block the agent is working on'
                  : 'Go to the last block the agent worked on'
              }
              data-testid="agent-show-target"
            >
              Show
            </button>
          ) : null}
          <RunStatusBadge status={status} />
        </span>
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
            ? answers
              ? 'It finished without an answer. The log shows what it did.'
              : 'It finished. The log shows what it did.'
            : session.questions.length > 0
              ? 'Waiting for you…'
              : 'Working…'}
        </p>
      )}

      <div className={styles.sessionActions}>
        {running ? (
          <Button
            onClick={() => sessionService.cancel(session.id)}
            data-testid="cancel-agent"
            title={
              queued > 0 ? 'Stop this run; the next queued one starts' : undefined
            }
          >
            Stop
          </Button>
        ) : (
          <>
            {answers && session.output ? (
              <Button
                variant="primary"
                onClick={copyOutput}
                data-testid="copy-agent-output"
              >
                Copy answer
              </Button>
            ) : null}
            <Button onClick={() => sessionService.dismiss(session.id)}>
              Dismiss
            </Button>
          </>
        )}
        {session.runId ? (
          <Button
            variant="plain"
            onClick={() => onViewLog(session.runId as string)}
            data-testid="view-agent-log"
          >
            View log
          </Button>
        ) : null}
      </div>

      {!running && answers && session.output ? (
        <span className={styles.hint}>
          Nothing is written to the note — copy what you want to keep.
        </span>
      ) : null}
      {!running && !answers ? (
        <span className={styles.hint}>
          It works in the note itself — its changes are already there.
        </span>
      ) : null}
    </div>
  );
};

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
  const sessions = useLiveData(sessionService.sessions$);
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

  const runningCount = sessions.filter(session => session.running).length;
  const onDeviceBusy = sessions.some(
    session => session.running && session.onDevice
  );
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
                      onDeviceBusy && sessionService.queues(agent)
                        ? `Queue ${agent.name} after the on-device run going`
                        : `Run ${agent.name}`
                    }
                  >
                    <span className={styles.agentEmoji}>
                      <AgentIcon agent={agent} />
                    </span>
                    <span className={styles.agentName}>{agent.name}</span>
                    {sessions.some(
                      session => session.running && session.agentId === agent.id
                    ) ? (
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

          {runningCount > 1 || (runningCount > 0 && queue.length > 0) ? (
            <div className={styles.sessionActions}>
              <span className={styles.hint}>{runningCount} running</span>
              <Button
                onClick={() => sessionService.cancelAll()}
                data-testid="cancel-all-agents"
              >
                Stop all
              </Button>
            </div>
          ) : null}

          {sessions.map(session => (
            <SessionCard
              key={session.id}
              session={session}
              queued={session.onDevice ? queue.length : 0}
              onViewLog={setLogRunId}
              onShowTarget={runActions.showTarget}
            />
          ))}

          {queue.length > 0 ? (
            <div className={styles.section} data-testid="agent-queue">
              <span className={styles.sectionLabel}>
                Up next on this device ({queue.length})
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
                    onShowTarget={runActions.showRunTarget}
                    onRetry={runActions.retry}
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

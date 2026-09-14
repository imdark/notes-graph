import { PlusIcon } from '@blocksuite/icons/rc';
import { Button, Scrollable } from '@notesgraph/component';
import {
  type Agent,
  AgentIcon,
  type AgentRun,
  AgentRunSessionService,
  AgentRunsStore,
  AgentsService,
} from '@notesgraph/core/modules/agents';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { DocService } from '@notesgraph/core/modules/doc';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';

import * as styles from './agents.css';

const relativeTime = (at: number) => {
  const secs = Math.round((Date.now() - at) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

const RunRow = ({ run }: { run: AgentRun }) => (
  <div className={styles.runRow}>
    <span className={styles.runDot} data-status={run.status} />
    <div className={styles.runText}>
      <span className={styles.runName}>{run.agentName}</span>
      <span className={styles.runMeta}>
        {run.status === 'error'
          ? (run.error ?? 'failed')
          : run.status === 'cancelled'
            ? 'cancelled'
            : run.status === 'running'
              ? 'running…'
              : (run.summary || 'done')}
      </span>
    </div>
    <span className={styles.runWhen}>{relativeTime(run.startedAt)}</span>
  </div>
);

export const EditorAgentsPanel = () => {
  const agentsService = useService(AgentsService);
  const sessionService = useService(AgentRunSessionService);
  const runsStore = useService(AgentRunsStore);
  const dialogService = useService(WorkspaceDialogService);
  const doc = useService(DocService).doc;

  const docAgents = useLiveData(agentsService.agentsFor$('doc'));
  const session = useLiveData(sessionService.session$);
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

  // The panel is where someone realises they want an agent, so it has to be
  // able to get them there rather than naming a screen they have to go find.
  const openAgentSettings = useCallback(() => {
    dialogService.open('setting', { activeTab: 'workspace:agents' });
  }, [dialogService]);

  return (
    <Scrollable.Root className={styles.root}>
      <Scrollable.Viewport>
        <div className={styles.body}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Run on this note</span>
            {docAgents.length === 0 ? (
              <p className={styles.empty}>
                No agents can run on a whole note yet.
              </p>
            ) : (
              <div className={styles.agentList}>
                {docAgents.map(agent => (
                  <button
                    key={agent.id}
                    className={styles.agentButton}
                    disabled={running}
                    onClick={() => runOnDoc(agent)}
                    data-testid="run-agent"
                  >
                    <span className={styles.agentEmoji}>
                      <AgentIcon agent={agent} />
                    </span>
                    <span className={styles.agentName}>{agent.name}</span>
                  </button>
                ))}
              </div>
            )}
            <Button
              onClick={openAgentSettings}
              data-testid="panel-new-agent"
              prefix={<PlusIcon />}
            >
              New agent
            </Button>
            <span className={styles.hint}>
              To run one on a single block, type <code>/</code> in the editor
              and pick it there.
            </span>
          </div>

          {session ? (
            <div className={styles.section} data-testid="agent-session">
              <span className={styles.sectionLabel}>
                {session.agentName} · {session.targetLabel}
              </span>

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
                  {running ? 'Working…' : 'No answer.'}
                </p>
              )}

              <div className={styles.sessionActions}>
                {running ? (
                  <Button
                    onClick={() => sessionService.cancel()}
                    data-testid="cancel-agent"
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button onClick={() => sessionService.clear()}>Clear</Button>
                )}
              </div>

              {!running && session.output ? (
                <span className={styles.hint}>
                  Nothing is written to the note — copy what you want to keep.
                </span>
              ) : null}
            </div>
          ) : null}

          {runs.length > 0 ? (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Recent runs here</span>
              <div className={styles.runList}>
                {runs.slice(0, 8).map(run => (
                  <RunRow key={run.id} run={run} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Scrollable.Viewport>
      <Scrollable.Scrollbar />
    </Scrollable.Root>
  );
};

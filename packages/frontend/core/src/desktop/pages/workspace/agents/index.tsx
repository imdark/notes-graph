import { PlusIcon } from '@blocksuite/icons/rc';
import { Button, useConfirmModal } from '@notesgraph/component';
import {
  type Agent,
  AgentIcon,
  type AgentRun,
  AgentRunsStore,
  AgentsService,
  deviceHarnessName,
} from '@notesgraph/core/modules/agents';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import {
  ViewBody,
  ViewHeader,
  ViewIcon,
  ViewTitle,
  WorkbenchService,
} from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

import { AgentQuestionCard } from '../detail-page/tabs/agent-question';
import { AgentRunLogDialog } from '../detail-page/tabs/agent-run-log';
import {
  relativeTime,
  type RunDisplayStatus,
  RunRow,
  RunStatusBadge,
  useMinuteTick,
} from '../detail-page/tabs/agent-run-row';
import {
  type RemoteRunState,
  useRemoteRunStates,
} from '../detail-page/tabs/use-run-questions';
import { useRunActions } from '../detail-page/tabs/use-run-actions';
import * as styles from './agents-page.css';
import { MonitorsSection } from './monitors-section';

type RunFilter = 'all' | 'waiting' | 'running' | 'error' | 'done';

const FILTERS: { id: RunFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Needs you' },
  { id: 'running', label: 'Running' },
  { id: 'error', label: 'Failed' },
  { id: 'done', label: 'Done' },
];

/** Runs listed before "Show more". */
const PAGE_SIZE = 30;

/**
 * What a run should read as. A remote run's row is written by the tab that
 * started it, so if that tab closed mid-run the row still says running; the
 * device job is the truth then.
 */
const displayStatus = (
  run: AgentRun,
  remote: RemoteRunState | undefined
): RunDisplayStatus => {
  if (run.status !== 'running' || !remote) return run.status;
  if (remote.questions.length > 0) return 'waiting';
  switch (remote.jobStatus) {
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    case 'cancelled':
      return 'cancelled';
    case 'queued':
      return 'queued';
    default:
      return 'running';
  }
};

const whereItRuns = (agent: Agent) => {
  const engine =
    agent.harness === 'research' ? 'Research' : deviceHarnessName(agent.model);
  const place =
    agent.harness === 'remote'
      ? `on ${agent.deviceKey ?? 'a device'}`
      : agent.harness === 'cloud' || agent.harness === 'research'
        ? 'in the cloud'
        : 'on this device';
  return engine ? `${engine} ${place}` : `Runs ${place}`;
};

const AgentCard = ({
  agent,
  lastRun,
  runCount,
  active,
  now,
  onSelect,
}: {
  agent: Agent;
  lastRun: AgentRun | undefined;
  runCount: number;
  active: boolean;
  now: number;
  onSelect: (agent: Agent) => void;
}) => (
  <button
    className={styles.agentCard}
    data-active={active || undefined}
    data-disabled={!agent.enabled || undefined}
    onClick={() => onSelect(agent)}
    title={active ? 'Show all runs' : `Show runs of ${agent.name}`}
    data-testid="agents-page-agent"
  >
    <span className={styles.agentCardHead}>
      <span className={styles.agentCardIcon}>
        <AgentIcon agent={agent} />
      </span>
      <span className={styles.agentCardName}>{agent.name}</span>
      {!agent.enabled ? <span className={styles.pill}>Off</span> : null}
      <span className={styles.pill}>
        {agent.scope === 'workspace' ? 'Shared' : 'Private'}
      </span>
    </span>
    <span className={styles.agentCardMeta}>{whereItRuns(agent)}</span>
    <span className={styles.agentCardFoot}>
      {lastRun ? (
        <>
          <RunStatusBadge status={lastRun.status} />
          <span>
            last {relativeTime(lastRun.startedAt, now)} · {runCount}{' '}
            {runCount === 1 ? 'run' : 'runs'}
          </span>
        </>
      ) : (
        <span>Never run</span>
      )}
    </span>
  </button>
);

const AgentsPage = () => {
  const agentsService = useService(AgentsService);
  const runsStore = useService(AgentRunsStore);
  const dialogService = useService(WorkspaceDialogService);
  const workbench = useService(WorkbenchService).workbench;
  const now = useMinuteTick();
  const runActions = useRunActions({ openDoc: true });
  const { openConfirmModal } = useConfirmModal();

  const agents = useLiveData(agentsService.agents$);
  const runs = useLiveData(useMemo(() => runsStore.watchRuns(), [runsStore]));
  const remote = useRemoteRunStates(runs);

  const [filter, setFilter] = useState<RunFilter>('all');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [logRunId, setLogRunId] = useState<string | null>(null);
  const closeLog = useCallback(() => setLogRunId(null), []);

  const openSettings = useCallback(() => {
    dialogService.open('setting', { activeTab: 'workspace:agents' });
  }, [dialogService]);
  const openDoc = useCallback(
    (docId: string) => workbench.openDoc(docId, { at: 'active' }),
    [workbench]
  );
  const selectAgent = useCallback((agent: Agent) => {
    setAgentId(prev => (prev === agent.id ? null : agent.id));
    setLimit(PAGE_SIZE);
  }, []);

  const statuses = useMemo(
    () =>
      new Map(
        runs.map(run => [run.id, displayStatus(run, remote.get(run.id))])
      ),
    [runs, remote]
  );

  const byAgent = useMemo(() => {
    const map = new Map<string, AgentRun[]>();
    for (const run of runs) {
      const list = map.get(run.agentId) ?? [];
      list.push(run);
      map.set(run.agentId, list);
    }
    return map;
  }, [runs]);

  const agentRuns = useMemo(
    () => (agentId ? runs.filter(run => run.agentId === agentId) : runs),
    [runs, agentId]
  );

  const counts = useMemo(() => {
    const c: Record<RunFilter, number> = {
      all: agentRuns.length,
      waiting: 0,
      running: 0,
      error: 0,
      done: 0,
    };
    for (const run of agentRuns) {
      const status = statuses.get(run.id);
      if (status === 'waiting') c.waiting++;
      else if (status === 'running') c.running++;
      else if (status === 'error') c.error++;
      else if (status === 'done') c.done++;
    }
    return c;
  }, [agentRuns, statuses]);

  const shown = useMemo(
    () =>
      filter === 'all'
        ? agentRuns
        : agentRuns.filter(run => statuses.get(run.id) === filter),
    [agentRuns, filter, statuses]
  );

  // A live run can't be deleted: its row would be written again when it ends.
  const deletable = useMemo(
    () =>
      shown.filter(run => {
        const status = statuses.get(run.id);
        return status !== 'running' && status !== 'waiting';
      }),
    [shown, statuses]
  );
  const confirmDeleteShown = useCallback(() => {
    const ids = deletable.map(run => run.id);
    openConfirmModal({
      title: `Delete ${ids.length} ${ids.length === 1 ? 'run' : 'runs'}?`,
      description:
        'They and their logs are removed from your run history. What the agents wrote into your notes stays.',
      confirmText: 'Delete',
      confirmButtonOptions: { variant: 'error' },
      onConfirm: () => runsStore.delete(ids),
    });
  }, [deletable, openConfirmModal, runsStore]);

  // Questions are the one thing here that blocks a run, so they lead the
  // page whatever the filters say.
  const waiting = useMemo(
    () =>
      runs.filter(
        run =>
          run.remoteJobId && (remote.get(run.id)?.questions.length ?? 0) > 0
      ),
    [runs, remote]
  );

  const selectedAgent = agents.find(agent => agent.id === agentId);

  return (
    <>
      <ViewTitle title="Agents" />
      <ViewIcon icon="ai" />
      <ViewHeader>
        <div className={styles.headerBar}>
          <Button onClick={openSettings} data-testid="agents-page-manage">
            Manage agents
          </Button>
          <Button
            variant="primary"
            prefix={<PlusIcon />}
            onClick={openSettings}
            data-testid="agents-page-new"
          >
            New agent
          </Button>
        </div>
      </ViewHeader>
      <ViewBody>
        <div className={styles.body}>
          <div className={styles.content}>
            {waiting.length > 0 ? (
              <section
                className={styles.section}
                data-testid="agents-page-waiting"
              >
                <div className={styles.sectionTitle}>
                  Needs you
                  <span className={styles.sectionCount}>{waiting.length}</span>
                </div>
                {waiting.map(run => (
                  <div key={run.id} className={styles.waitingCard}>
                    <div className={styles.runs}>
                      <RunRow
                        run={run}
                        status="waiting"
                        now={now}
                        onOpen={setLogRunId}
                        onOpenDoc={openDoc}
                        onShowTarget={runActions.showRunTarget}
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

            <section className={styles.section}>
              <div className={styles.sectionTitle}>
                Agents
                <span className={styles.sectionCount}>{agents.length}</span>
              </div>
              {agents.length === 0 ? (
                <div className={styles.empty}>
                  No agents yet. An agent is a saved instruction you can run on
                  a block, a selection or a whole note.
                  <div style={{ marginTop: 12 }}>
                    <Button variant="primary" onClick={openSettings}>
                      Create your first agent
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={styles.agentGrid}>
                  {agents.map(agent => {
                    const list = byAgent.get(agent.id) ?? [];
                    return (
                      <AgentCard
                        key={agent.id}
                        agent={agent}
                        lastRun={list[0]}
                        runCount={list.length}
                        active={agent.id === agentId}
                        now={now}
                        onSelect={selectAgent}
                      />
                    );
                  })}
                </div>
              )}
            </section>

            <MonitorsSection now={now} />

            <section className={styles.section}>
              <div className={styles.sectionTitle}>
                {selectedAgent ? `Runs of ${selectedAgent.name}` : 'Runs'}
                {selectedAgent || deletable.length > 0 ? (
                  <div className={styles.sectionActions}>
                    {deletable.length > 0 ? (
                      <Button
                        variant="plain"
                        onClick={confirmDeleteShown}
                        data-testid="agents-page-delete-shown"
                      >
                        Delete {deletable.length} ended{' '}
                        {deletable.length === 1 ? 'run' : 'runs'}
                      </Button>
                    ) : null}
                    {selectedAgent ? (
                      <Button variant="plain" onClick={() => setAgentId(null)}>
                        Show all agents
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className={styles.filters}>
                {FILTERS.map(({ id, label }) => (
                  <button
                    key={id}
                    className={styles.chip}
                    data-active={filter === id || undefined}
                    onClick={() => {
                      setFilter(id);
                      setLimit(PAGE_SIZE);
                    }}
                    data-testid={`agents-page-filter-${id}`}
                  >
                    {label}
                    <span className={styles.chipCount}>{counts[id]}</span>
                  </button>
                ))}
              </div>
              {shown.length === 0 ? (
                <div className={styles.empty}>
                  {runs.length === 0
                    ? 'Nothing has run yet. Open a note and run an agent from the Agents side panel, or press Ctrl/⌘ K in the editor.'
                    : 'No runs match.'}
                </div>
              ) : (
                <div className={styles.runs} data-testid="agents-page-runs">
                  {shown.slice(0, limit).map(run => (
                    <RunRow
                      key={run.id}
                      run={run}
                      status={statuses.get(run.id)}
                      now={now}
                      onOpen={setLogRunId}
                      onOpenDoc={openDoc}
                      onShowTarget={runActions.showRunTarget}
                      onRetry={runActions.retry}
                      onDelete={runActions.remove}
                    />
                  ))}
                </div>
              )}
              {shown.length > limit ? (
                <Button
                  className={styles.showMore}
                  variant="plain"
                  onClick={() => setLimit(prev => prev + PAGE_SIZE)}
                >
                  Show more ({shown.length - limit})
                </Button>
              ) : null}
            </section>
          </div>
        </div>
      </ViewBody>
      <AgentRunLogDialog runId={logRunId} onClose={closeLog} />
    </>
  );
};

export const Component = () => {
  return <AgentsPage />;
};

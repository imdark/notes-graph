import { Button, notify } from '@notesgraph/component';
import {
  type AgentRun,
  AgentRunsStore,
  AgentsService,
  deployableTasks,
  DeploymentsService,
  deployRunsFor,
  type RunTask,
  shipAgents,
  shipReportText,
  shipsWithAutomations,
} from '@notesgraph/core/modules/agents';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  DeployInProgress,
  useDeployCiRuns,
} from '@notesgraph/core/components/deployments';
import { RunRow, useMinuteTick } from './agent-run-row';
import * as styles from './agents.css';

/** Why there is nothing to deploy, from what the run's blocks say now. */
const nothingToDeploy = (tasks: RunTask[]): string => {
  if (tasks.length === 0) {
    return 'This run wasn’t on a task, so there is nothing here to deploy. The Deployments page lists every task ready to go out.';
  }
  if (tasks.every(task => task.stage === 'deployed')) {
    return 'Its task is already DEPLOYED. It waits for someone to check it live.';
  }
  const statuses = [
    ...new Set(tasks.map(task => task.status?.toUpperCase() ?? 'no status')),
  ].join(', ');
  return `Its task is ${statuses}. A deploy takes a task once its branch has a pull request (COMMITTED) or is on main (MERGED).`;
};

/**
 * Deploy what a finished run made, and follow the deploys sent for it.
 *
 * The run's task, once its branch is pushed, carries COMMITTED and its pull
 * request; Deploy merges it and deploys main with the merge and deploy
 * automations, run by wf on the ship agent's device, as the Deployments
 * page does. From the cloud runner, which has no deploy, it goes to Claude
 * Code instead; those runs are listed below, each opening its own log.
 */
export const AgentRunDeploy = ({
  run,
  summary,
  onOpenRun,
}: {
  run: AgentRun;
  /** The run's answer, which may name a pull request its task doesn't. */
  summary: string | null;
  onOpenRun: (runId: string) => void;
}) => {
  const deployments = useService(DeploymentsService);
  // Deploy with the merge and deploy automations instead of Claude Code.
  const withAutomations = useLiveData(
    useService(FeatureFlagService).flags.enable_deploy_with_automations.$
  );
  const agentsService = useService(AgentsService);
  const runsStore = useService(AgentRunsStore);
  const now = useMinuteTick();

  const agents = useLiveData(agentsService.agents$);
  const agent = useMemo(() => shipAgents(agents)[0], [agents]);
  const deployCiRuns = useDeployCiRuns(agent);
  useEffect(() => {
    deployments.refreshDeployInfo().catch(() => {});
  }, [deployments]);
  const docRuns = useLiveData(
    useMemo(() => runsStore.watchRunsForDoc(run.docId), [runsStore, run.docId])
  );
  const deployRuns = useMemo(() => deployRunsFor(docRuns, run), [docRuns, run]);
  const deploying = deployRuns.some(other => other.status === 'running');

  // Read again as each deploy ends, since it moves the task on.
  const [tasks, setTasks] = useState<RunTask[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  // Bumped when a deploy through the automations ends, which moves it on.
  const [deploysDone, setDeploysDone] = useState(0);
  const endedDeploys = deployRuns.filter(
    other => other.status !== 'running'
  ).length;
  // The run's row is a new object on every store update; read on what it
  // points at instead.
  const { docId } = run;
  const blockKey = (run.blockIds ?? (run.blockId ? [run.blockId] : [])).join(
    '\n'
  );
  useEffect(() => {
    let cancelled = false;
    setReadError(null);
    deployments
      .runTasks(
        { docId, blockIds: blockKey ? blockKey.split('\n') : [] },
        summary
      )
      .then(read => {
        if (!cancelled) setTasks(read);
      })
      .catch(err => {
        if (cancelled) return;
        setTasks([]);
        setReadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [deployments, docId, blockKey, summary, endedDeploys, deploysDone]);

  const toDeploy = useMemo(() => deployableTasks(tasks ?? []), [tasks]);
  const [sending, setSending] = useState(false);
  // What the automations are doing now, or how they ended.
  const [progress, setProgress] = useState<{
    line: string;
    error?: boolean;
  } | null>(null);
  const deploy = useCallback(() => {
    if (!agent || toDeploy.length === 0) return;
    setSending(true);
    if (withAutomations && shipsWithAutomations(agent)) {
      setProgress({ line: 'Starting…' });
      deployments
        .mergeAndDeploy(agent, toDeploy, line => setProgress({ line }))
        .then(report => {
          const { ok, title, message } = shipReportText(report);
          setProgress({
            line: `${title}. ${message}`,
            error: !report.deployed,
          });
          (ok ? notify.success : notify.error)({ title, message });
        })
        .catch(err => {
          const message = err instanceof Error ? err.message : String(err);
          setProgress({ line: message, error: true });
          notify.error({ title: "The deploy didn't go out", message });
        })
        .finally(() => {
          setSending(false);
          // Its task moved on: read it again.
          setDeploysDone(n => n + 1);
        });
      return;
    }
    deployments
      .ship(agent, toDeploy, 'deploy')
      .then(target => {
        if (!target) return;
        notify.success({
          title: 'Deploy sent',
          message: `${agent.name} on ${agent.deviceKey} is on it. Its log is below once it starts.`,
        });
      })
      .catch(err =>
        notify.error({
          title: "Couldn't send the deploy",
          message: err instanceof Error ? err.message : String(err),
        })
      )
      .finally(() => setSending(false));
  }, [agent, deployments, toDeploy, withAutomations]);

  return (
    <div className={styles.changesScroll} data-testid="agent-run-deploy">
      <DeployInProgress runs={deployCiRuns} />
      <div className={styles.section}>
        <span className={styles.sectionLabel}>What it would deploy</span>
        {tasks === null ? (
          <p className={styles.empty}>Reading its task…</p>
        ) : readError ? (
          <p className={styles.error}>Couldn’t read its task: {readError}</p>
        ) : toDeploy.length === 0 ? (
          <p className={styles.empty} data-testid="agent-run-deploy-nothing">
            {nothingToDeploy(tasks)}
          </p>
        ) : (
          toDeploy.map(task => (
            <span
              key={task.blockId}
              className={styles.hint}
              data-testid="agent-run-deploy-task"
            >
              {task.stage.toUpperCase()} · {task.title || 'Untitled task'}
              {task.pullRequest ? (
                <>
                  {' · '}
                  <a href={task.pullRequest} target="_blank" rel="noreferrer">
                    {task.pullRequest.replace('https://github.com/', '')}
                  </a>
                </>
              ) : (
                ' · no pull request named; the agent finds it from the branch'
              )}
            </span>
          ))
        )}
        {toDeploy.length > 0 ? (
          <div className={styles.sessionActions}>
            {agent && shipsWithAutomations(agent) ? (
              <span className={styles.hint}>
                wf on {agent.deviceKey}{' '}
                {toDeploy.some(task => task.stage === 'committed')
                  ? 'merges its pull request with the merge automation, then deploys main with the deploy automation.'
                  : 'deploys main, where it is merged already, with the deploy automation.'}
              </span>
            ) : agent ? (
              <span className={styles.hint}>
                Goes to {agent.name} on {agent.deviceKey}, which{' '}
                {toDeploy.some(task => task.stage === 'committed')
                  ? 'merges its pull request, then deploys main.'
                  : 'deploys main, where it is merged already.'}
              </span>
            ) : (
              <span className={styles.hint}>
                No agent can deploy: that needs a Claude Code agent on a device,
                set up under Settings, Agents.
              </span>
            )}
            <Button
              variant="primary"
              disabled={!agent || sending || deploying}
              tooltip={
                deploying ? 'A deploy of this is still going' : undefined
              }
              onClick={deploy}
              data-testid="agent-run-deploy-button"
            >
              {sending ? 'Deploying…' : 'Deploy'}
            </Button>
          </div>
        ) : null}
        {progress ? (
          <p
            className={progress.error ? styles.error : styles.hint}
            data-testid="agent-run-deploy-progress"
          >
            {progress.line}
          </p>
        ) : null}
      </div>

      <div className={styles.section}>
        <span className={styles.sectionLabel}>
          Deploys of this ({deployRuns.length})
        </span>
        {deployRuns.length === 0 ? (
          <p className={styles.empty}>
            None sent yet. A deploy shows here as it starts; open it for its
            log.
          </p>
        ) : (
          <div className={styles.runList} data-testid="agent-run-deploy-runs">
            {deployRuns.map(other => (
              <RunRow key={other.id} run={other} now={now} onOpen={onOpenRun} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

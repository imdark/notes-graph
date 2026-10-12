import { Modal, notify } from '@notesgraph/component';
import { AgentRunLogDialog } from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/agent-run-log';
import {
  RunRow,
  useMinuteTick,
} from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/agent-run-row';
import * as styles from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/agents.css';
import {
  type Agent,
  AgentIcon,
  type AgentRun,
  AgentRunSessionService,
  AgentRunsStore,
  AgentsService,
  AgentTaskClaimService,
  agentTargetKey,
  RemoteAgentRunnerService,
} from '@notesgraph/core/modules/agents';
import type { DialogComponentProps } from '@notesgraph/core/modules/dialogs';
import type { WORKSPACE_DIALOG_SCHEMA } from '@notesgraph/core/modules/dialogs/constant';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

/**
 * Stop the runs still going on a block and give its tasks to another agent.
 *
 * Each run is stopped where it can be: here when this tab drives it, on the
 * server when it is a device job. The tasks then go back to to-do, so the
 * next agent claims them as it would a fresh task, and that agent is started
 * on what the newest run was on — a whole list, if it was working one.
 */
const useReassign = (runs: AgentRun[]) => {
  const sessionService = useService(AgentRunSessionService);
  const remoteRunner = useService(RemoteAgentRunnerService);
  const runsStore = useService(AgentRunsStore);
  const taskClaim = useService(AgentTaskClaimService);
  const workspaceService = useService(WorkspaceService);
  const sessions = useLiveData(sessionService.sessions$);

  const going = useMemo(
    () => runs.filter(run => run.status === 'running'),
    [runs]
  );
  // An on-device run in another tab or on another device has nothing here
  // to stop it, and would keep working the task beside the next agent.
  const unstoppable = going.some(
    run =>
      !run.remoteJobId &&
      !sessions.some(session => session.runId === run.id && session.running)
  );
  const target = useMemo(
    () => (runs[0] ? runsStore.targetOf(runs[0]) : null),
    [runs, runsStore]
  );

  const reassign = useCallback(
    async (agent: Agent) => {
      if (!target) return;
      const workspaceId = workspaceService.workspace.id;
      const live = sessionService.sessions$.value;
      await Promise.all(
        going.map(run => {
          const session = live.find(s => s.runId === run.id && s.running);
          if (session) return sessionService.stop(session.id);
          return run.remoteJobId
            ? remoteRunner.cancel(workspaceId, run.remoteJobId)
            : undefined;
        })
      );
      const key = agentTargetKey(target);
      for (const queued of sessionService.queue$.value) {
        if (agentTargetKey(queued.target) === key) {
          sessionService.dequeue(queued.id);
        }
      }
      // A device job hands its tasks back on the server; let that reach
      // here before the next agent claims them.
      await taskClaim.reopen(target, going.some(run => run.remoteJobId));
      void sessionService.start(agent, target);
    },
    [going, remoteRunner, sessionService, target, taskClaim, workspaceService]
  );

  return { reassign, target, canReassign: !!target && !unstoppable };
};

/**
 * The agent runs that worked on a block, opened by tapping the robot at the
 * end of its line. The desktop anchors a menu to the chip; a phone has no
 * room for one, so the runs are listed in a modal, each opening its log, with
 * the agents below to hand the block to instead.
 */
export const AgentBlockRunsDialog = ({
  close,
  runIds,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['agent-block-runs']>) => {
  const runsStore = useService(AgentRunsStore);
  const agentsService = useService(AgentsService);
  const workbench = useService(WorkbenchService).workbench;
  const now = useMinuteTick();
  const all = useLiveData(useMemo(() => runsStore.watchRuns(), [runsStore]));
  const runs = useMemo(
    () => all.filter(run => runIds.includes(run.id)),
    [all, runIds]
  );
  const [logRunId, setLogRunId] = useState<string | null>(null);
  const { reassign, target, canReassign } = useReassign(runs);
  const targetKind = target?.kind ?? 'block';
  const agents = useLiveData(
    useMemo(
      () => agentsService.agentsFor$(targetKind),
      [agentsService, targetKind]
    )
  );
  const running = runs.some(run => run.status === 'running');

  const openAgentsPage = useCallback(() => {
    workbench.open('/agents');
    close();
  }, [close, workbench]);

  const handTo = useCallback(
    (agent: Agent) => {
      close();
      notify({ title: `Handing it to ${agent.name}` });
      reassign(agent).catch(err =>
        notify.error({
          title: `Couldn't hand it to ${agent.name}`,
          message: err instanceof Error ? err.message : String(err),
        })
      );
    },
    [close, reassign]
  );

  if (logRunId) {
    return <AgentRunLogDialog runId={logRunId} onClose={close} />;
  }

  return (
    <Modal
      open
      onOpenChange={open => !open && close()}
      title="Agent runs on this block"
    >
      <div className={styles.section} data-testid="agent-block-runs">
        {runs.length === 0 ? (
          <p className={styles.empty}>
            These runs have been deleted from your run history.
          </p>
        ) : (
          <div className={styles.runList}>
            {runs.map(run => (
              <RunRow key={run.id} run={run} now={now} onOpen={setLogRunId} />
            ))}
          </div>
        )}

        {target && agents.length > 0 ? (
          <>
            <span className={styles.sectionLabel}>
              {running ? 'Stop it and give it to' : 'Give it to'}
            </span>
            {canReassign ? null : (
              <span className={styles.hint}>
                A run on this block is going in another tab or on another
                device. Stop it there first.
              </span>
            )}
            <div className={styles.agentList}>
              {agents.map(agent => (
                <button
                  key={agent.id}
                  className={styles.agentButton}
                  disabled={!canReassign}
                  onClick={() => handTo(agent)}
                  data-testid="agent-block-runs-reassign"
                >
                  <span className={styles.agentEmoji}>
                    <AgentIcon agent={agent} />
                  </span>
                  <span className={styles.agentName}>{agent.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        <div className={styles.panelFooter}>
          <button
            className={styles.linkButton}
            onClick={openAgentsPage}
            data-testid="agent-block-runs-all"
          >
            All runs →
          </button>
        </div>
      </div>
    </Modal>
  );
};

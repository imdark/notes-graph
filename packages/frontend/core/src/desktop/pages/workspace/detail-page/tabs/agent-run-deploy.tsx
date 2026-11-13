import { Button } from '@notesgraph/component';
import {
  type AgentRun,
  DeploymentsService,
  pullRequestNumber,
  releaseStageOf,
  type RunTask,
} from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useEffect, useState } from 'react';

import * as styles from './agents.css';

/**
 * Where what a finished run made is on its way out: its task's pull
 * request, and whether it is open, on stage, released or live. Merging and
 * releasing happen on the Deployments page.
 */
export const AgentRunDeploy = ({
  run,
  summary,
}: {
  run: AgentRun;
  /** The run's answer, which may name a pull request its task doesn't. */
  summary: string | null;
  /** Kept for the dialog's signature; this tab opens no other run. */
  onOpenRun?: (runId: string) => void;
}) => {
  const deployments = useService(DeploymentsService);
  const workbench = useService(WorkbenchService).workbench;
  const release = useLiveData(deployments.release$);

  // Read once if nothing has yet; the Deployments page keeps it fresh.
  useEffect(() => {
    if (deployments.release$.value === undefined) {
      deployments.refreshRelease().catch(() => {});
    }
  }, [deployments]);

  const [tasks, setTasks] = useState<RunTask[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
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
  }, [deployments, docId, blockKey, summary]);

  // Each pull request once, however many of its tasks name it.
  const pulls = [
    ...new Map(
      (tasks ?? []).flatMap(task => {
        const number = task.pullRequest
          ? pullRequestNumber(task.pullRequest)
          : null;
        return task.pullRequest && number
          ? [[task.pullRequest, { url: task.pullRequest, number }] as const]
          : [];
      })
    ).values(),
  ];

  return (
    <div className={styles.changesScroll} data-testid="agent-run-deploy">
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Where it is</span>
        {tasks === null ? (
          <p className={styles.empty}>Reading its task…</p>
        ) : readError ? (
          <p className={styles.error}>Couldn’t read its task: {readError}</p>
        ) : pulls.length === 0 ? (
          <p className={styles.empty} data-testid="agent-run-deploy-nothing">
            {tasks.length === 0
              ? 'This run wasn’t on a task, so it has no pull request to follow.'
              : 'Its task names no pull request yet; paste its URL under the task and it shows here.'}
          </p>
        ) : (
          pulls.map(pr => {
            const stage = releaseStageOf(pr.number, release);
            return (
              <span
                key={pr.url}
                className={styles.hint}
                data-testid="agent-run-deploy-pr"
              >
                <a href={pr.url} target="_blank" rel="noreferrer">
                  PR #{pr.number}
                </a>
                {' · '}
                {stage ??
                  (release === undefined
                    ? 'reading…'
                    : 'not in the recent releases')}
              </span>
            );
          })
        )}
        <div className={styles.sessionActions}>
          <Button
            onClick={() => workbench.open('/deployments')}
            data-testid="agent-run-deploy-open"
          >
            Open Deployments
          </Button>
        </div>
      </div>
    </div>
  );
};

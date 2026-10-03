import {
  type AgentRun,
  openQuestions,
  RemoteAgentRunnerService,
  type RemoteJob,
  type RemoteQuestion,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';
import { useEffect, useMemo, useState } from 'react';

export interface RemoteRunState {
  questions: RemoteQuestion[];
  /** The job's own status; the run row can lag it when its tab closed early. */
  jobStatus: RemoteJob['status'];
}

/**
 * Follow every running remote run in `runs` and report what each is waiting
 * on, keyed by run id. Watching never cancels: this is a viewer, not the tab
 * that started the run.
 */
export const useRemoteRunStates = (
  runs: AgentRun[]
): Map<string, RemoteRunState> => {
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceService = useService(WorkspaceService);
  const [states, setStates] = useState(() => new Map<string, RemoteRunState>());

  // Re-subscribe only when the set of running remote runs changes, not on
  // every unrelated update to the run list.
  const key = runs
    .filter(run => run.status === 'running' && run.remoteJobId)
    .map(run => `${run.id}:${run.remoteJobId}`)
    .sort()
    .join(',');
  const watched = useMemo(
    () =>
      key
        ? key.split(',').map(pair => {
            const [runId, jobId] = pair.split(':');
            return { runId, jobId };
          })
        : [],
    [key]
  );

  useEffect(() => {
    setStates(prev => {
      const next = new Map<string, RemoteRunState>();
      for (const { runId } of watched) {
        const state = prev.get(runId);
        if (state) next.set(runId, state);
      }
      return next;
    });
    if (watched.length === 0) return;

    const controller = new AbortController();
    const workspaceId = workspaceService.workspace.id;
    for (const { runId, jobId } of watched) {
      (async () => {
        for await (const { job } of remoteRunner.watch(
          workspaceId,
          jobId,
          controller.signal,
          { cancelOnAbort: false }
        )) {
          setStates(prev =>
            new Map(prev).set(runId, {
              questions: openQuestions(job),
              jobStatus: job.status,
            })
          );
        }
      })().catch(() => {
        // A run we can't reach just shows as running; its log says why.
      });
    }
    return () => controller.abort();
  }, [watched, remoteRunner, workspaceService]);

  return states;
};

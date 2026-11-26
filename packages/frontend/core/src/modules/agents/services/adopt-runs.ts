import type { AgentRun } from '../stores/agent-runs';
import type { RemoteJob } from './remote-runner';

/**
 * Which device jobs the Agents page should take on as runs, and which of
 * its own runs they are.
 *
 * The page lists the runs this browser recorded. A job started anywhere else
 * (an agent's subtask via start_agent_run, another device, an automation)
 * has no record here, so neither it nor its questions showed. And a run
 * whose start request timed out (the app gives up after 15 seconds; the
 * server can take longer to answer) was recorded as failed with no job id,
 * though the server had queued the job and a device ran it to the end.
 */

/** How far back a job is still taken on. */
export const ADOPT_WITHIN_MS = 3 * 24 * 60 * 60 * 1000;
/** How close a lost run's start and its job's queueing must be. */
const SAME_START_MS = 2 * 60 * 1000;

/** A run that failed to start for want of an answer, with no job of its own. */
export const isLostStart = (run: AgentRun) =>
  run.status === 'error' &&
  !run.remoteJobId &&
  /Network error|timeout after/i.test(run.error ?? '');

export type Adoption =
  /** A lost start: the run is this job; attach it and settle from the job. */
  | { kind: 'reattach'; runId: string; job: RemoteJob }
  /** A job this browser has no run for: record it. */
  | { kind: 'adopt'; job: RemoteJob & { docId: string; createdAt: number } };

export function planAdoptions(
  jobs: RemoteJob[],
  runs: AgentRun[],
  now: number,
  /** Jobs whose runs were deleted here. */
  dismissed: ReadonlySet<string> = new Set()
): Adoption[] {
  const known = new Set(
    runs.map(run => run.remoteJobId).filter((id): id is string => !!id)
  );
  const lost = runs.filter(isLostStart);
  // Still starting in this browser: the job id is on its way back.
  const starting = runs.filter(
    run => run.status === 'running' && !run.remoteJobId && run.kind !== 'ask'
  );
  const sameStart = (run: AgentRun, job: RemoteJob, queuedAt: number) =>
    run.agentId === job.agentId &&
    run.docId === job.docId &&
    Math.abs(run.startedAt - queuedAt) <= SAME_START_MS;
  const plan: Adoption[] = [];
  for (const job of jobs) {
    if (known.has(job.id) || dismissed.has(job.id)) continue;
    // Health checks and other jobs on no note aren't runs a person started.
    if (!job.docId || !job.createdAt) continue;
    const queuedAt = job.createdAt * 1000;
    if (now - queuedAt > ADOPT_WITHIN_MS) continue;
    if (starting.some(run => sameStart(run, job, queuedAt))) continue;
    const match = lost.find(run => sameStart(run, job, queuedAt));
    if (match) {
      lost.splice(lost.indexOf(match), 1);
      plan.push({ kind: 'reattach', runId: match.id, job });
    } else {
      plan.push({
        kind: 'adopt',
        job: { ...job, docId: job.docId, createdAt: job.createdAt },
      });
    }
  }
  return plan;
}

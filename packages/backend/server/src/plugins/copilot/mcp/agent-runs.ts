import type { RegistryJob } from '@prisma/client';

/**
 * What `list_agent_runs` says about each recent run: enough to review them
 * (did it ship, did it fail, where did its work go) without the full log,
 * which can run to megabytes. See the Run review agent on the Agents page.
 */
export interface AgentRunSummary {
  id: string;
  title: string | null;
  agentName: string;
  device: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  result: string | null;
  /** The run's git work, when it had any: the branch and its commits. */
  git: { branch: string | null; commits: string[]; files: number } | null;
  notes: { created: number; edited: number };
  /** How often a tool's permission request failed ("Stream closed" and the like). */
  permissionFailures: number;
  /** The end of the log, where a run that stopped early says why. */
  logTail: string;
}

const ERROR_CHARS = 400;
const RESULT_CHARS = 800;
const LOG_TAIL_CHARS = 600;
const PERMISSION_FAILURE = /Tool permission (request failed|stream closed)/g;

const clip = (text: string | null | undefined, chars: number) => {
  if (!text) return null;
  return text.length > chars ? `${text.slice(0, chars)}…` : text;
};

const tail = (text: string | null | undefined, chars: number) => {
  if (!text) return '';
  return text.length > chars ? `…${text.slice(-chars)}` : text;
};

interface StoredChanges {
  notes?: { created?: unknown[]; edited?: unknown[] };
  git?: {
    branch?: string;
    commits?: { subject?: string }[];
    stat?: unknown[];
  };
}

export function summarizeRun(job: RegistryJob): AgentRunSummary {
  const changes = (job.changes ?? null) as StoredChanges | null;
  const git = changes?.git;
  return {
    id: job.id,
    title: job.title,
    agentName: job.agentName,
    device: job.deviceKey,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    error: clip(job.error, ERROR_CHARS),
    result: clip(job.result, RESULT_CHARS),
    git: git
      ? {
          branch: git.branch ?? null,
          commits: (git.commits ?? []).map(c => String(c.subject ?? '')),
          files: (git.stat ?? []).length,
        }
      : null,
    notes: {
      created: changes?.notes?.created?.length ?? 0,
      edited: changes?.notes?.edited?.length ?? 0,
    },
    permissionFailures: (job.log ?? '').match(PERMISSION_FAILURE)?.length ?? 0,
    logTail: tail(job.log, LOG_TAIL_CHARS),
  };
}

/**
 * The agent runs created in the last `days`, newest first, still running
 * ones included. `jobs` is newest first, as the model lists them.
 */
export function agentRunsAnswer(
  jobs: RegistryJob[],
  days: number,
  now: Date = new Date()
) {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const runs = jobs
    .filter(job => job.kind === 'agent' && job.createdAt >= since)
    .map(summarizeRun);
  return { since: since.toISOString(), count: runs.length, runs };
}

import type { RegistryJob } from '@prisma/client';

import { isTaskStatus } from '../registry/task-status';

/**
 * Hooks around agent runs: what an automation's code is given, and what its
 * return value is taken to mean.
 *
 * prestart: `input` is `{hook: 'prestart', job}`. Return `false` or
 * `{allow: false, reason}` to stop the run; `{instructions, context}` to
 * rewrite them; anything else lets it start. A prestart hook that throws,
 * times out or never runs stops the run too: a check that couldn't run
 * isn't a pass.
 *
 * end: `input` is `{hook: 'end', job, tasks}`, `tasks` being each task's
 * status as the run left it (`[-]` in progress, `[X]` done, an org keyword
 * like `DONE`...). Return `{status: 'error', error}` to fail a run that
 * ended done, and/or `{tasks}`, one status for all of the run's tasks or one
 * per block id, to set them.
 */

/** A run's job, as a hook sees it. */
export function hookJob(job: RegistryJob) {
  return {
    id: job.id,
    agentId: job.agentId,
    agentName: job.agentName,
    deviceKey: job.deviceKey,
    model: job.model,
    title: job.title,
    instructions: job.instructions,
    context: job.context,
    docId: job.docId,
    blockId: job.blockId,
    taskIds: job.taskIds ?? [],
    status: job.status,
    result: job.result,
    error: job.error,
    steps: job.steps,
    costUsd: job.costUsd,
  };
}

/** Most instructions or context a prestart hook may write. */
const MAX_REWRITE_CHARS = 100_000;

export type PrestartVerdict =
  | { allow: true; instructions?: string; context?: string }
  | { allow: false; reason: string };

/** What a prestart hook's output says to do with the run. */
export function prestartVerdict(output: unknown): PrestartVerdict {
  if (output === false) return { allow: false, reason: 'not allowed' };
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { allow: true };
  }
  const o = output as Record<string, unknown>;
  if (o.allow === false) {
    return {
      allow: false,
      reason: String(o.reason ?? 'not allowed').slice(0, 500),
    };
  }
  const verdict: PrestartVerdict = { allow: true };
  if (typeof o.instructions === 'string' && o.instructions.trim()) {
    verdict.instructions = o.instructions.slice(0, MAX_REWRITE_CHARS);
  }
  if (typeof o.context === 'string') {
    verdict.context = o.context.slice(0, MAX_REWRITE_CHARS);
  }
  return verdict;
}

export interface EndActions {
  /** Fail the run with this error (only one that ended done). */
  fail?: string;
  /** New statuses for the run's tasks, by block id. */
  tasks?: Record<string, string>;
}

/** What an end hook's output says to do, for a run on these tasks. */
export function endActions(output: unknown, taskIds: string[]): EndActions {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return {};
  }
  const o = output as Record<string, unknown>;
  const actions: EndActions = {};
  if (o.status === 'error') {
    actions.fail = String(o.error ?? 'failed its end check').slice(0, 2000);
  }
  if (typeof o.tasks === 'string' && isTaskStatus(o.tasks)) {
    const status = o.tasks;
    actions.tasks = Object.fromEntries(taskIds.map(id => [id, status]));
  } else if (o.tasks && typeof o.tasks === 'object') {
    actions.tasks = Object.fromEntries(
      Object.entries(o.tasks as Record<string, unknown>).filter(
        ([id, status]) =>
          taskIds.includes(id) &&
          typeof status === 'string' &&
          isTaskStatus(status)
      ) as [string, string][]
    );
  }
  return actions;
}

/** The automation to start from: a run that failed leaves its tasks failed. */
export const FAIL_TASKS_TEMPLATE = `// End hook: a run that failed while its tasks were in progress marks
// them FAILED, instead of handing them back as to-do.
if (input.job.status !== 'error') return;
const failed = {};
for (const [id, status] of Object.entries(input.tasks)) {
  if (status === '[-]') failed[id] = 'FAILED';
}
return { tasks: failed };
`;

/** A prestart check to start from: stops runs with no instructions to go on. */
export const REQUIRE_INSTRUCTIONS_TEMPLATE = `// Prestart hook: a run with almost nothing to go on is stopped before it
// spends anything.
if (input.job.instructions.trim().length < 20) {
  return { allow: false, reason: 'the instructions are too short to act on' };
}
`;

/** What the app offers to start an automation from. */
export const AUTOMATION_TEMPLATES = [
  {
    id: 'fail-tasks-on-error',
    name: 'Mark tasks FAILED when a run fails',
    description:
      'When an agent run ends in an error, its tasks still in progress become FAILED instead of going back to to-do.',
    triggers: [{ type: 'hook', hook: 'end' }],
    code: FAIL_TASKS_TEMPLATE,
  },
  {
    id: 'require-instructions',
    name: 'Stop runs with too little to go on',
    description:
      'Before an agent run starts, stop it if its instructions are under 20 characters.',
    triggers: [{ type: 'hook', hook: 'prestart' }],
    code: REQUIRE_INSTRUCTIONS_TEMPLATE,
  },
];

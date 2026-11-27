import type { JobDto } from '../../registry/jobs';

/**
 * `start_agent_run` and `agent_run_status`: an agent starting another agent
 * on a task (one it refiled under another project, or a subtask it splits
 * off to run in parallel) and following it to the end.
 */

/** What a started run is: the server's agent profiles it may name. */
export const SUBTASK_KINDS = ['workflow', 'claude-code', 'research'] as const;
export type SubtaskKind = (typeof SUBTASK_KINDS)[number];

const KIND_NAMES: Record<SubtaskKind, string> = {
  workflow: 'Subtask (wf task)',
  'claude-code': 'Subtask (Claude Code)',
  research: 'Subtask (research)',
};

const DEFAULT_INSTRUCTIONS =
  'Work the task above to the end, as its note and any lines under it ' +
  'describe. Keep its status current with update_task. For code, finish ' +
  'with the change committed on a branch with a pull request.';

export interface SubtaskInput {
  kind: SubtaskKind;
  docId: string;
  blockId: string;
  /** The task's text: as given, else as indexed, else a pointer to it. */
  task: string | null;
  noteTitle: string | null;
  instructions?: string;
  /** The job of the run starting it, when it says. */
  parentJobId?: string;
  /** Who is starting it (the MCP `agent` attribution). */
  startedBy?: string;
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The body `RegistryJobService.enqueue` takes for a subtask run. */
export function subtaskJobBody(input: SubtaskInput): Record<string, unknown> {
  const task = input.task ? oneLine(input.task) : null;
  const from = [
    input.startedBy ? `the agent "${input.startedBy}"` : 'another agent',
    input.parentJobId ? `(run ${input.parentJobId})` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const context = [
    `Note: ${input.noteTitle ?? 'Untitled'}`,
    `Task: docId ${input.docId}, blockId ${input.blockId}.`,
    `Started by ${from}, which follows this run with agent_run_status.`,
    task ??
      `Read the task with read_document (docId ${input.docId}) and find block ${input.blockId}.`,
  ].join('\n');
  return {
    agentId: `subtask-${input.kind}`,
    agentName: KIND_NAMES[input.kind],
    model: input.kind,
    title: task
      ? task.slice(0, 120)
      : `Subtask in ${input.noteTitle ?? 'a note'}`,
    instructions: input.instructions?.trim() || DEFAULT_INSTRUCTIONS,
    context,
    targetKind: 'block',
    docId: input.docId,
    blockId: input.blockId,
    taskIds: [input.blockId],
  };
}

const LOG_TAIL_CHARS = 1500;
const RESULT_CHARS = 2000;

const clip = (text: string | null | undefined, chars: number) =>
  !text ? null : text.length > chars ? `${text.slice(0, chars)}…` : text;

/** What `agent_run_status` says about a run, for an agent following it. */
export function runStatusAnswer(job: JobDto) {
  const ended = ['done', 'error', 'cancelled', 'blocked'].includes(job.status);
  const questions = (job.questions ?? [])
    .filter(q => !q.answeredAt)
    .map(q => ({ id: q.id, kind: q.kind, text: q.text }));
  const log = job.log ?? '';
  return {
    jobId: job.id,
    title: job.title,
    device: job.deviceKey,
    status: job.status,
    ended,
    heldUntil: job.runAfter,
    createdAt: new Date(job.createdAt * 1000).toISOString(),
    finishedAt: job.finishedAt
      ? new Date(job.finishedAt * 1000).toISOString()
      : null,
    // A person answers these in NotesGraph (Agents → Needs you).
    waitingFor: questions,
    result: clip(job.result, RESULT_CHARS),
    error: clip(job.error, RESULT_CHARS),
    logTail:
      log.length > LOG_TAIL_CHARS ? `…${log.slice(-LOG_TAIL_CHARS)}` : log,
    next: ended
      ? 'The run has ended: read its result.'
      : questions.length
        ? 'The run waits for a person to answer in NotesGraph; check again later.'
        : 'Still running: check again in a minute or two.',
  };
}

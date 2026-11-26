import type { SavedAskChat } from '../stores/agent-run-logs';
import type { AgentRun } from '../stores/agent-runs';
import type { ChatMessage } from './cloud-runner';
import type { AgentContext } from './context';
import { stampLines } from './log-lines';

/**
 * A chat about a run that has ended — done, failed or stopped — so the reader
 * can ask the agent's context what it did, why it stopped, or what's left,
 * without starting the run over.
 *
 * Like the question fork (question-fork.ts) it is a separate conversation
 * seeded with the run's context: what it was given, its transcript and how it
 * ended. Nothing it says reaches the run or the note.
 */

/** How much of the run's final answer the chat is given. */
export const RUN_CHAT_OUTPUT_CHARS = 6_000;

/** What the chat knows about the run, beyond the row itself. */
export interface RunChatContext {
  /** The transcript, stamps already stripped (see forkTranscript). */
  transcript: string;
  /** The run's full answer when it is known; else the row's summary is used. */
  output?: string;
}

const ending = (run: AgentRun): string => {
  switch (run.status) {
    case 'error':
      return `It failed: ${run.error || 'no reason was recorded.'}`;
    case 'cancelled':
      return 'It was stopped before it finished.';
    case 'running':
      return 'It is still running.';
    case 'done':
      return 'It finished.';
  }
};

/** The opening of the chat: what it is for and everything known of the run. */
export function runChatMessages(
  run: AgentRun,
  { transcript, output }: RunChatContext
): ChatMessage[] {
  const instructions = [
    `You are answering the reader's questions about a run of their AI agent "${run.agentName}" that has ended.`,
    'You have what the agent was given, the transcript of what it did, and how it ended. Speak about the run as its record: what it did and found, why it stopped or failed, what it changed, and what is left to do.',
    "You cannot act: you don't run tools or change notes or files, and the agent doesn't see this chat. If the reader wants something done, say what to ask the agent for when they run it again.",
    runDied(run)
      ? 'This run ended before its work was done. The reader can continue it: what they write and choose to continue with starts a new run of the agent, given this record and this chat. When they want the work finished, say what to tell it.'
      : null,
    "Be concise, and say plainly when the record doesn't tell you something rather than guessing.",
  ]
    .filter(Boolean)
    .join('\n');

  const answer = (output ?? run.summary ?? '').trim();
  const clipped =
    answer.length > RUN_CHAT_OUTPUT_CHARS
      ? `${answer.slice(0, RUN_CHAT_OUTPUT_CHARS - 1)}…`
      : answer;

  const record = [
    `Run: ${run.title || run.agentName}`,
    [
      `Started ${new Date(run.startedAt).toISOString()}`,
      run.deviceKey ? `on ${run.deviceKey}` : null,
      run.harness ? `(${run.harness})` : null,
      run.steps ? `${run.steps} step${run.steps === 1 ? '' : 's'}` : null,
    ]
      .filter(Boolean)
      .join(' '),
    ending(run),
    run.input ? `<input>\n${run.input}\n</input>` : null,
    clipped ? `<answer>\n${clipped}\n</answer>` : null,
    transcript
      ? `<transcript>\n${transcript}\n</transcript>`
      : 'There is no transcript of the run to go on.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return [
    { role: 'system', content: instructions },
    { role: 'user', content: record },
  ];
}

/**
 * Whether the run's session ended before its work did: it failed or was
 * stopped. Its ask chat can then continue it as a follow-up run.
 */
export const runDied = (run: AgentRun): boolean =>
  run.status === 'error' || run.status === 'cancelled';

/** How much of the ask chat a follow-up run is given. */
export const FOLLOW_UP_CHAT_CHARS = 4_000;

/**
 * What a follow-up run reads: the task as it reads now, then the earlier
 * run's record (how it ended, its transcript, its last answer), the chat the
 * reader had about it, and what they want done next.
 *
 * The earlier session is gone, so the follow-up is a new agent rebuilt from
 * that record rather than a resumed one. It keeps the task's ids, so its
 * claims and run list entry are the task's as before.
 */
export function continuationBrief(
  task: AgentContext,
  run: AgentRun,
  { transcript, output }: RunChatContext,
  followUp: string,
  chat: SavedAskChat['turns'] = []
): AgentContext {
  const answer = (output ?? run.summary ?? '').trim();
  const clipped =
    answer.length > RUN_CHAT_OUTPUT_CHARS
      ? `${answer.slice(0, RUN_CHAT_OUTPUT_CHARS - 1)}…`
      : answer;
  const talk = chat
    .filter(turn => turn.content.trim())
    .map(turn =>
      turn.role === 'user'
        ? `Reader: ${turn.content}`
        : `About the run: ${turn.content}`
    )
    .join('\n\n');
  const talked =
    talk.length > FOLLOW_UP_CHAT_CHARS
      ? `…${talk.slice(-(FOLLOW_UP_CHAT_CHARS - 1))}`
      : talk;

  const earlier = [
    '## This continues an earlier run',
    [
      `An earlier run of this agent on this task, started ${new Date(run.startedAt).toISOString()}${run.deviceKey ? ` on ${run.deviceKey}` : ''}, ended before its work was done. ${ending(run)}`,
      'Its session is gone, so you are a new run picking up where it stopped. Before redoing anything, check what it already did (the notes, the branch and its commits, the files) and go on from there.',
    ].join(' '),
    transcript
      ? `<previous-transcript>\n${transcript}\n</previous-transcript>`
      : 'There is no transcript of the earlier run.',
    clipped ? `<previous-answer>\n${clipped}\n</previous-answer>` : null,
    talked
      ? `The reader talked the run over before continuing it:\n<chat>\n${talked}\n</chat>`
      : null,
    followUp.trim()
      ? `What the reader wants now:\n${followUp.trim()}`
      : 'Finish what the earlier run set out to do.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { ...task, text: `${task.text}\n\n${earlier}` };
}

/**
 * An ask chat as a run log, for its row's Log tab: each question and answer
 * stamped with when it was sent, and the error a turn ended on, if any.
 */
export function askTranscript(
  turns: SavedAskChat['turns'],
  error?: string,
  at = Date.now()
): string {
  const lines = turns.map(turn => {
    const files = turn.files?.length
      ? ` (attached: ${turn.files.join(', ')})`
      : '';
    const text =
      turn.role === 'user'
        ? `? ${turn.content}${files}`
        : turn.content || '(no answer)';
    return stampLines(text, turn.at ?? at);
  });
  if (error) lines.push(stampLines(`✗ ${error}`, at));
  return lines.length ? `${lines.join('\n')}\n` : '';
}

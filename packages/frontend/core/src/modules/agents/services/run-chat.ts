import type { SavedAskChat } from '../stores/agent-run-logs';
import type { AgentRun } from '../stores/agent-runs';
import type { ChatMessage } from './cloud-runner';
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
    "Be concise, and say plainly when the record doesn't tell you something rather than guessing.",
  ].join('\n');

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

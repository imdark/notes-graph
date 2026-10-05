import type { ChatMessage } from './cloud-runner';
import { parseLogLines } from './log-lines';
import type { RemoteQuestion } from './remote-runner';

/**
 * A side conversation about one question a run is waiting on, so the reader
 * can ask what it means, what each choice would lead to, or what the agent
 * has done so far before committing to an answer.
 *
 * It is a fork: it starts from the run's context (the question and the
 * transcript up to it) but goes to a separate model conversation. The run
 * never sees it and keeps waiting; only the answer the reader finally sends
 * reaches it.
 */

/** How much of the run's transcript the fork is given; the end matters most. */
export const FORK_TRANSCRIPT_CHARS = 12_000;

/** The line a fork reply ends with when it has an answer to propose. */
const SUGGESTION = /^\s*suggested answer:\s*(.+?)\s*$/im;

/** The transcript without its time stamps, cut to its last `limit` chars. */
export function forkTranscript(
  log: string,
  limit = FORK_TRANSCRIPT_CHARS
): string {
  const text = parseLogLines(log)
    .map(line => line.text)
    .join('\n');
  if (text.length <= limit) return text;
  // Start at a line boundary so the first line isn't half a line.
  const tail = text.slice(-limit);
  const newline = tail.indexOf('\n');
  return `…\n${newline >= 0 ? tail.slice(newline + 1) : tail}`;
}

/** The opening of the fork conversation: what it is for and what it knows. */
export function forkMessages(
  question: RemoteQuestion,
  transcript: string
): ChatMessage[] {
  const isPermission = question.kind === 'permission';
  const instructions = [
    'An AI agent working for the reader has stopped to ask them something and is waiting for their reply.',
    'Before they reply, they want to talk it through with you. Answer their questions about what the agent is asking, why it might be asking, and what each possible reply would lead to, using the transcript of the run so far.',
    "You cannot reach the agent and you do not answer for the reader: they send the reply themselves. Be concise and say plainly when the transcript doesn't tell you something.",
    isPermission
      ? 'The agent wants permission to use a tool. When you have a recommendation, say whether you would allow or deny it and why.'
      : 'When you have a reply to propose, end your message with one line "Suggested answer: <the reply, as the reader would send it>". Leave that line out otherwise.',
  ].join('\n');

  const asked = [
    isPermission
      ? `The agent wants permission to: ${question.text}`
      : `The agent asks: ${question.text}`,
    question.detail
      ? `${isPermission ? 'Tool input' : 'Detail'}:\n${question.detail}`
      : null,
    !isPermission && question.options?.length
      ? `Choices it offered: ${question.options.join(' | ')}`
      : null,
    transcript
      ? `<transcript>\n${transcript}\n</transcript>`
      : 'There is no transcript of the run to go on.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return [
    { role: 'system', content: instructions },
    { role: 'user', content: asked },
  ];
}

/**
 * Split a fork reply into what to show and the answer it proposes, if any.
 * The suggestion line is taken out of the shown text: it gets its own button.
 */
export function splitSuggestion(reply: string): {
  text: string;
  suggestion: string | null;
} {
  const match = SUGGESTION.exec(reply);
  if (!match) return { text: reply, suggestion: null };
  const suggestion = match[1].replace(/^["“](.*)["”]$/, '$1').trim();
  return {
    text: reply.replace(match[0], '').trim(),
    suggestion: suggestion || null,
  };
}

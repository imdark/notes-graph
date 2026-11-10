import { BehaviorSubject } from 'rxjs';

import type {
  AIChatAction,
  AIChatSendOptions,
} from '../blocksuite/ai/runtime/chat/actions';

export interface AskAgentRequest {
  workspaceId: string;
  question: string;
}

/**
 * A question asked from Ctrl-K, waiting for the AI chat page to send it.
 * Kept outside React so it survives the page mounting after Ctrl-K closes,
 * and observable so an already open chat page picks it up too.
 */
export const pendingAskAgent$ = new BehaviorSubject<AskAgentRequest | null>(
  null
);

export function askAgent(workspaceId: string, question: string) {
  pendingAskAgent$.next({ workspaceId, question });
}

/** Returns the pending question for this workspace and clears it. */
export function takeAskAgent(workspaceId: string): string | null {
  const pending = pendingAskAgent$.value;
  if (!pending || pending.workspaceId !== workspaceId) return null;
  pendingAskAgent$.next(null);
  return pending.question;
}

/**
 * The message the chat sends. The chat model has the workspace search tools;
 * this tells it to use them for earlier learnings before answering, so the
 * answer draws on what the user already wrote down.
 */
export function buildAskAgentPrompt(question: string) {
  return [
    question,
    '',
    'Before answering, search my notes for what I already know about this: ' +
      'first learnings and lessons (notes tagged #learning, #lesson or #til, ' +
      'and notes under "Agent lessons"), then any other related notes. ' +
      'Run more than one search if the first finds little. Answer from what ' +
      'you find, cite the notes you used, and say plainly if my notes do not ' +
      'cover it.',
  ].join('\n');
}

/** Sends the question in a fresh chat, so it doesn't land in an old thread. */
export async function sendAskAgent(
  runtime: { dispatch: (action: AIChatAction) => Promise<void> },
  question: string,
  options: Omit<AIChatSendOptions, 'input'>
) {
  await runtime.dispatch({ type: 'createNewSession' });
  await runtime.dispatch({
    ...options,
    type: 'send',
    input: buildAskAgentPrompt(question),
  });
}

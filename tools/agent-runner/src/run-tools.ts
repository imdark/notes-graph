/**
 * The run's own tools: asking the person who started it something, naming
 * it, and putting a tool call to them for permission. The cloud twin of wf's
 * agent_mcp.py, in-process instead of a stdio MCP server.
 */
import {
  type CanUseTool,
  createSdkMcpServer,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { type NotesGraphApi, NotesGraphError, type Question } from './api';

/** Matches the server's cap on a question's detail (inventory jobs.ts MAX_DETAIL). */
const MAX_DETAIL = 200_000;

export class JobCancelled extends Error {}

export interface RunContext {
  api: NotesGraphApi;
  workspaceId: string;
  jobId: string;
  /** How often to look for an answer. */
  pollMs?: number;
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** Post a question and wait until it is answered; throws if the run stops. */
export async function ask(
  ctx: RunContext,
  kind: 'question' | 'permission',
  text: string,
  extra: { detail?: string | null; options?: string[] } = {}
): Promise<Question> {
  const question = await ctx.api.ask(ctx.workspaceId, ctx.jobId, { kind, text, ...extra });
  if (question.answeredAt) return question; // allowed by "Allow all"
  for (;;) {
    if (ctx.signal?.aborted) throw new JobCancelled('the run was stopped');
    await sleep(ctx.pollMs ?? 2000, ctx.signal);
    let current: { question: Question; jobStatus: string };
    try {
      current = await ctx.api.getQuestion(ctx.workspaceId, ctx.jobId, question.id);
    } catch (err) {
      // A server blip while someone is thinking is not an answer; keep waiting.
      if (err instanceof NotesGraphError && err.status === undefined) continue;
      throw err;
    }
    if (current.question.answeredAt) return current.question;
    if (current.jobStatus !== 'running') {
      throw new JobCancelled(`the run is ${current.jobStatus}`);
    }
  }
}

const text = (value: string, isError = false) => ({
  content: [{ type: 'text' as const, text: value }],
  isError,
});

/** The `run` MCP server: mcp__run__ask_user and mcp__run__set_title. */
export function runServer(ctx: RunContext) {
  return createSdkMcpServer({
    name: 'run',
    version: '1',
    tools: [
      tool(
        'ask_user',
        'Ask the person who started this run a question and wait for their ' +
          'answer. Use it whenever you need a fact you could not find in ' +
          'NotesGraph or a decision only they can make. Ask one short, ' +
          'specific question; group closely related unknowns into it. When ' +
          'the answer is one of a few choices (yes/no, which of these, go on ' +
          'or stop), pass them as options so they can pick with one click; ' +
          'they can still type something else.',
        {
          question: z.string().describe('The question, as you would ask it in person.'),
          options: z
            .array(z.string())
            .optional()
            .describe('Optional short choices, e.g. ["Yes, open the PR", "No, stop here"]. At most 10.'),
        },
        async ({ question, options }) => {
          const asked = question.trim();
          if (!asked) return text('question is required', true);
          try {
            const answer = await ask(ctx, 'question', asked, {
              options: (options ?? []).map(o => o.trim()).filter(Boolean),
            });
            return text(answer.answer ?? '');
          } catch (err) {
            return stopOr(err);
          }
        }
      ),
      tool(
        'set_title',
        "Name this run in NotesGraph's run list, which until then shows the " +
          'text of the block it started from. Call it once you know what you ' +
          'are doing, with a few words a person would recognise; call it ' +
          'again if the work turns out to be something else.',
        { title: z.string().describe('A short title, e.g. "Pick a show to watch with Cosmo".') },
        async ({ title }) => {
          const name = title.split(/\s+/).filter(Boolean).join(' ');
          if (!name) return text('title is required', true);
          try {
            const kept = await ctx.api.setTitle(ctx.workspaceId, ctx.jobId, name);
            return text(`Run renamed to: ${kept}`);
          } catch (err) {
            return text(`Could not rename the run (${err}); carry on.`, true);
          }
        }
      ),
    ],
  });
}

function stopOr(err: unknown) {
  if (err instanceof JobCancelled) {
    return text(`Stop: ${err.message}. Do not continue the task.`, true);
  }
  return text(`Could not reach NotesGraph to ask: ${err}`, true);
}

/**
 * A tool the profile doesn't pre-approve goes to the person, as on the Mac:
 * NotesGraph shows it under "Needs you" (and on their phone), with the input.
 */
export function permissionPrompt(ctx: RunContext): CanUseTool {
  return async (toolName, input) => {
    let answer: Question;
    try {
      answer = await ask(ctx, 'permission', `Allow ${toolName}?`, {
        // Compact and uncut up to the server's cap: NotesGraph parses it to
        // show an edit as a diff, and clipped JSON does not parse.
        detail: JSON.stringify(input).slice(0, MAX_DETAIL),
      });
    } catch (err) {
      return {
        behavior: 'deny',
        message: err instanceof JobCancelled ? `Stop: ${err.message}.` : `Could not ask: ${err}`,
        interrupt: err instanceof JobCancelled,
      };
    }
    if (answer.allowed) return { behavior: 'allow', updatedInput: input };
    const note = answer.answer ?? '';
    return {
      behavior: 'deny',
      message: 'The user denied this.' + (note ? ` They said: ${note}` : ''),
    };
  };
}

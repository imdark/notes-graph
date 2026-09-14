import { Service } from '@notesgraph/infra';

import type { AiBackendService, LocalLLMService } from '../../ai-local';
import { type Agent, DEFAULT_MAX_STEPS } from '../stores/agents';
import type { AgentRunsStore } from '../stores/agent-runs';
import type { AgentContextService } from './context';
import {
  type AgentFileToolsService,
  FILE_TOOL_NAMES,
  FILE_TOOLS,
} from './file-tools';
import { type AgentTarget, agentTargetKey } from './target';
import {
  buildToolPrompt,
  type ParsedToolCall,
  parseToolCall,
  stripToolBlocks,
} from './tool-protocol';

export type AgentEvent =
  | { type: 'step'; index: number }
  | { type: 'tool'; name: string; args: unknown }
  | { type: 'text'; delta: string }
  | { type: 'done'; output: string }
  | { type: 'error'; message: string };

export interface AgentExecutor {
  run(
    agent: Agent,
    target: AgentTarget,
    signal: AbortSignal
  ): AsyncIterable<AgentEvent>;
}

/** A run that never answers must still end. */
const WALL_CLOCK_MS = 120_000;

export class AgentAlreadyRunningError extends Error {
  constructor() {
    super('That agent is already running here.');
  }
}

/**
 * Runs agents in the tab against the on-device model.
 *
 * Two paths. An agent given file tools, in a workspace with a folder bound,
 * runs a reason→tool→result loop (see `runWithTools`). Anything else takes the
 * original text-only path: read the target, answer, done.
 *
 * Tool calls use the fenced-block protocol in `tool-protocol.ts` rather than a
 * provider's native function calling, because the on-device harness is a small
 * WebLLM model. A server-side executor using the native
 * `llmDispatchToolLoopStream` can still be dropped in behind this interface
 * once a workspace has copilot configured.
 */
export class AgentExecutorService extends Service implements AgentExecutor {
  constructor(
    private readonly contextService: AgentContextService,
    private readonly runsStore: AgentRunsStore,
    private readonly localLLM: LocalLLMService,
    private readonly aiBackend: AiBackendService,
    private readonly fileTools: AgentFileToolsService
  ) {
    super();
  }

  /**
   * Reason → call a tool → read the result → repeat, until the model answers
   * or `maxSteps` is spent.
   *
   * A tool that throws is not fatal: the error text goes back to the model as
   * the step's result, so a wrong path or a malformed block costs one step and
   * can be corrected, which is the common case with a small on-device model.
   */
  private async *runWithTools(
    agent: Agent,
    contextText: string,
    toolNames: string[],
    signal: AbortSignal
  ): AsyncIterable<AgentEvent> {
    const specs = FILE_TOOLS.filter(spec => toolNames.includes(spec.name));
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] =
      [
        {
          role: 'system',
          content: [
            agent.instructions.trim() ||
              'Help the reader with the content below.',
            '',
            buildToolPrompt(specs),
          ].join('\n'),
        },
        { role: 'user', content: contextText },
      ];

    const maxSteps = Math.max(1, agent.maxSteps || DEFAULT_MAX_STEPS);

    for (let step = 0; step < maxSteps; step++) {
      if (signal.aborted) return;
      yield { type: 'step', index: step };

      let reply = '';
      for await (const delta of this.localLLM.chatStream(messages, {
        signal,
        model: agent.model,
      })) {
        reply += delta;
      }
      if (signal.aborted) return;

      let call: ParsedToolCall | null;
      try {
        call = parseToolCall(reply);
      } catch (err) {
        messages.push(
          { role: 'assistant', content: reply },
          { role: 'user', content: (err as Error).message }
        );
        continue;
      }

      // No tool block: this is the answer.
      if (!call) {
        const answer = stripToolBlocks(reply);
        yield { type: 'text', delta: answer };
        yield { type: 'done', output: answer };
        return;
      }

      yield { type: 'tool', name: call.name, args: call.args };

      let result: string;
      try {
        result = await this.fileTools.call(call.name, call.args);
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      messages.push(
        { role: 'assistant', content: reply },
        { role: 'user', content: `Result of ${call.name}:\n${result}` }
      );
    }

    // Out of steps with no answer — say so rather than returning silence.
    const message = `Stopped after ${maxSteps} steps without a final answer.`;
    yield { type: 'text', delta: message };
    yield { type: 'done', output: message };
  }

  /** Targets with a run in flight, so a double-click can't start two. */
  private readonly inFlight = new Set<string>();

  /**
   * The runtime an agent will actually use: its own choice, else the
   * workspace's AI backend setting.
   */
  harnessFor(agent: Agent): 'on-device' | 'cloud' {
    if (agent.harness) return agent.harness;
    return this.aiBackend.backend$.value === 'local' ? 'on-device' : 'cloud';
  }

  async *run(
    agent: Agent,
    target: AgentTarget,
    signal: AbortSignal
  ): AsyncIterable<AgentEvent> {
    const key = agentTargetKey(target);
    if (this.inFlight.has(key)) {
      throw new AgentAlreadyRunningError();
    }
    this.inFlight.add(key);

    const runId = this.runsStore.start(agent, target);
    // Cancellation has two sources — the caller's signal and the wall clock —
    // funnelled into one controller so the stream and the run record only ever
    // have to look at a single aborted flag.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), WALL_CLOCK_MS);
    const onOuterAbort = () => controller.abort();
    signal.addEventListener('abort', onOuterAbort);

    let output = '';
    try {
      // Only the on-device harness exists so far. Fail loudly rather than
      // silently running somewhere the agent wasn't configured to run.
      const harness = this.harnessFor(agent);
      if (harness !== 'on-device') {
        throw new Error(
          `This agent is set to run on ${harness}, which isn't available here yet. Switch it to on-device in Settings → Agents.`
        );
      }
      const context = await this.contextService.build(target);

      // An agent given file tools, in a workspace with a folder bound, runs
      // the tool loop; everything else keeps the original text-only path.
      const fileTools = agent.tools.filter(name =>
        FILE_TOOL_NAMES.includes(name)
      );
      const useTools = fileTools.length > 0 && this.fileTools.available;

      if (useTools) {
        let steps = 0;
        for await (const event of this.runWithTools(
          agent,
          context.text,
          fileTools,
          controller.signal
        )) {
          if (event.type === 'step') steps = event.index + 1;
          if (event.type === 'text') output += event.delta;
          if (event.type === 'done') output = event.output;
          yield event;
        }

        if (controller.signal.aborted) {
          this.runsStore.finish(runId, { status: 'cancelled', steps });
          return;
        }
        this.runsStore.finish(runId, { status: 'done', steps, output });
        return;
      }

      yield { type: 'step', index: 0 };

      const messages = [
        {
          role: 'system' as const,
          content: [
            agent.instructions.trim() ||
              'Answer the question about the content below.',
            '',
            'You are given the content the reader selected. Answer about that',
            'content only, and say so plainly if it does not contain what is',
            'needed rather than inventing it.',
          ].join('\n'),
        },
        { role: 'user' as const, content: context.text },
      ];

      for await (const delta of this.localLLM.chatStream(messages, {
        signal: controller.signal,
        model: agent.model,
      })) {
        output += delta;
        yield { type: 'text', delta };
      }

      if (controller.signal.aborted) {
        this.runsStore.finish(runId, { status: 'cancelled', steps: 1 });
        return;
      }

      this.runsStore.finish(runId, { status: 'done', steps: 1, output });
      yield { type: 'done', output };
    } catch (err) {
      // An abort surfaces as a throw from the stream; that's a cancel, not a
      // failure, and shouldn't be recorded as one.
      if (controller.signal.aborted) {
        this.runsStore.finish(runId, { status: 'cancelled', steps: 1 });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.runsStore.finish(runId, { status: 'error', steps: 1, error: message });
      yield { type: 'error', message };
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener('abort', onOuterAbort);
      this.inFlight.delete(key);
    }
  }
}

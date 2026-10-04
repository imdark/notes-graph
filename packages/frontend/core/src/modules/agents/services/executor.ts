import { Service } from '@notesgraph/infra';

import type { LocalLLMService } from '../../ai-local';
import {
  type Agent,
  type AgentHarness,
  DEFAULT_MAX_STEPS,
} from '../stores/agents';
import type { AgentRunLogsStore } from '../stores/agent-run-logs';
import type { AgentRunsStore } from '../stores/agent-runs';
import type { ChatModel, CloudAgentRunnerService } from './cloud-runner';
import type { AgentContextService } from './context';
import {
  type AgentFileToolsService,
  FILE_TOOL_NAMES,
  FILE_TOOLS,
} from './file-tools';
import type { WorkspaceService } from '../../workspace';
import {
  openQuestions,
  RemoteAgentRunnerService,
  type RemoteQuestion,
} from './remote-runner';
import { stampLines } from './log-lines';
import { type AgentTarget, agentTargetKey } from './target';
import {
  buildToolPrompt,
  type ParsedToolCall,
  parseToolCall,
  stripToolBlocks,
} from './tool-protocol';

export type AgentEvent =
  /** First event of every run: the record its log is kept under. */
  | { type: 'started'; runId: string }
  | { type: 'step'; index: number }
  /** Transcript text — what a person watching the run would want to see. */
  | { type: 'log'; text: string }
  /**
   * What a remote run is waiting for the reader to answer, sent whenever it
   * changes; an empty list means it is no longer waiting.
   */
  | { type: 'waiting'; jobId: string; questions: RemoteQuestion[] }
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
/**
 * A device gives a job 15 minutes (`run_job` in `wf agent serve`). The tab
 * must outlast that, or a slow remote run is cancelled from here while the
 * device is still making progress on it.
 */
const REMOTE_WALL_CLOCK_MS = 16 * 60_000;
/**
 * Each cloud step is a server round trip, and a tool loop takes several, so
 * the on-device limit would cut off a run that is working.
 */
const CLOUD_WALL_CLOCK_MS = 10 * 60_000;
/** How much of a tool result goes into the transcript. */
const LOG_TOOL_RESULT_CHARS = 400;

/**
 * Appended straight to the saved transcript rather than yielded: after a
 * cancel the consumer may already have stopped listening.
 */
const cancelledLine = () => stampLines('■ cancelled\n', Date.now());

const logLine = (text: string): AgentEvent => ({
  type: 'log',
  text: stampLines(text.endsWith('\n') ? text : `${text}\n`, Date.now()),
});

/**
 * The agent's model, if WebLLM can load it. An agent saved while the default
 * harness meant cloud may carry a server model id; on-device that would fail
 * to load, so it falls back to the default local model instead. Every WebLLM
 * prebuilt id ends in `-MLC`.
 */
const onDeviceModel = (agent: Agent) =>
  agent.model?.endsWith('-MLC') ? agent.model : undefined;

const clip = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

export class AgentAlreadyRunningError extends Error {
  constructor() {
    super('That agent is already running here.');
  }
}

/**
 * Runs agents in the tab, against the on-device model or the server's
 * copilot model (`cloud`), or hands them to a registered device (`remote`).
 *
 * In the tab there are two paths. An agent given file tools, in a workspace
 * with a folder bound, runs a reason→tool→result loop (see `runWithTools`).
 * Anything else takes the original text-only path: read the target, answer,
 * done. Both take the model as a {@link ChatModel}, so on-device and cloud
 * differ only in where each step's reply comes from.
 *
 * Tool calls use the fenced-block protocol in `tool-protocol.ts` rather than a
 * provider's native function calling, because the on-device harness is a small
 * WebLLM model and the loop is shared with it.
 */
export class AgentExecutorService extends Service implements AgentExecutor {
  constructor(
    private readonly contextService: AgentContextService,
    private readonly runsStore: AgentRunsStore,
    private readonly runLogs: AgentRunLogsStore,
    private readonly localLLM: LocalLLMService,
    private readonly fileTools: AgentFileToolsService,
    private readonly remoteRunner: RemoteAgentRunnerService,
    private readonly cloudRunner: CloudAgentRunnerService,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
  }

  /** The model an in-tab run asks each step: the browser's, or the server's. */
  private async modelFor(
    agent: Agent,
    harness: 'on-device' | 'cloud'
  ): Promise<ChatModel> {
    if (harness === 'on-device') {
      return (messages, signal) =>
        this.localLLM.chatStream(messages, {
          signal,
          model: onDeviceModel(agent),
        });
    }
    const workspaceId = this.workspaceId;
    if (!workspaceId) {
      throw new Error('No workspace is open, so there is no server to ask.');
    }
    return this.cloudRunner.open(workspaceId);
  }

  /** The workspace a remote job is queued against. */
  private get workspaceId(): string | undefined {
    return this.workspaceService.workspace?.id;
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
    model: ChatModel,
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
      yield logLine(`── step ${step + 1}`);

      let reply = '';
      for await (const delta of model(messages, signal)) {
        reply += delta;
      }
      if (signal.aborted) return;

      let call: ParsedToolCall | null;
      try {
        call = parseToolCall(reply);
      } catch (err) {
        yield logLine(`✗ couldn't read the tool call: ${(err as Error).message}`);
        messages.push(
          { role: 'assistant', content: reply },
          { role: 'user', content: (err as Error).message }
        );
        continue;
      }

      // No tool block: this is the answer.
      if (!call) {
        const answer = stripToolBlocks(reply);
        yield logLine(answer);
        yield { type: 'text', delta: answer };
        yield { type: 'done', output: answer };
        return;
      }

      const thinking = stripToolBlocks(reply).trim();
      if (thinking) yield logLine(thinking);
      yield { type: 'tool', name: call.name, args: call.args };
      yield logLine(`→ ${call.name}  ${clip(JSON.stringify(call.args), 160)}`);

      let result: string;
      try {
        result = await this.fileTools.call(call.name, call.args);
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      yield logLine(
        `  ${result.startsWith('Error:') ? '✗' : '←'} ${clip(result.replace(/\s+/g, ' '), LOG_TOOL_RESULT_CHARS)}`
      );

      messages.push(
        { role: 'assistant', content: reply },
        { role: 'user', content: `Result of ${call.name}:\n${result}` }
      );
    }

    // Out of steps with no answer — say so rather than returning silence.
    const message = `Stopped after ${maxSteps} steps without a final answer.`;
    yield logLine(`■ ${message}`);
    yield { type: 'text', delta: message };
    yield { type: 'done', output: message };
  }

  /**
   * Agent + target pairs with a run in flight, so a double-click can't start
   * two. Different agents on the same block may run side by side.
   */
  private readonly inFlight = new Set<string>();

  /**
   * The runtime an agent will actually use: its own choice, else on-device.
   *
   * The default used to follow the workspace's AI backend, but that is `cloud`
   * unless someone switched it, and cloud needs a server with Copilot set up —
   * so agents left on the default failed before they started on servers
   * without it. Only an agent explicitly set to cloud runs there now.
   */
  harnessFor(agent: Agent): AgentHarness {
    return agent.harness ?? 'on-device';
  }

  async *run(
    agent: Agent,
    target: AgentTarget,
    signal: AbortSignal
  ): AsyncIterable<AgentEvent> {
    const key = `${agent.id}:${agentTargetKey(target)}`;
    if (this.inFlight.has(key)) {
      throw new AgentAlreadyRunningError();
    }
    this.inFlight.add(key);

    const runId = this.runsStore.start(agent, target);
    const harness = this.harnessFor(agent);
    // Cancellation has two sources — the caller's signal and the wall clock —
    // funnelled into one controller so the stream and the run record only ever
    // have to look at a single aborted flag.
    const controller = new AbortController();
    const limit =
      harness === 'remote'
        ? REMOTE_WALL_CLOCK_MS
        : harness === 'cloud'
          ? CLOUD_WALL_CLOCK_MS
          : WALL_CLOCK_MS;
    let deadline: ReturnType<typeof setTimeout> | null = setTimeout(
      () => controller.abort(),
      limit
    );
    // A run waiting on the reader is not stalled: the clock stops while a
    // question is open and starts afresh once it is answered. The device
    // does the same with its own limit.
    const pauseClock = (waiting: boolean) => {
      if (waiting && deadline) {
        clearTimeout(deadline);
        deadline = null;
      } else if (!waiting && !deadline && !controller.signal.aborted) {
        deadline = setTimeout(() => controller.abort(), limit);
      }
    };
    const onOuterAbort = () => controller.abort();
    signal.addEventListener('abort', onOuterAbort);

    let output = '';
    let steps = 0;
    // The on-device transcript, saved when the run ends. A remote run's is
    // kept by the server, so nothing accumulates here for it.
    let log = '';
    const record = (event: AgentEvent): AgentEvent => {
      if (event.type === 'log' && harness !== 'remote') log += event.text;
      return event;
    };
    yield { type: 'started', runId };
    try {
      const context = await this.contextService.build(target);

      if (harness === 'remote') {
        for await (const event of this.runRemote(
          runId,
          agent,
          context.text,
          controller.signal
        )) {
          if (event.type === 'step') steps = event.index + 1;
          if (event.type === 'text') output += event.delta;
          if (event.type === 'done') output = event.output;
          if (event.type === 'waiting') pauseClock(event.questions.length > 0);
          yield event;
        }
        // An abort ends the watch quietly (the job is cancelled on the way
        // out), so the loop finishing doesn't by itself mean the job did.
        if (controller.signal.aborted) {
          this.runsStore.finish(runId, { status: 'cancelled', steps });
          return;
        }
        this.runsStore.finish(runId, { status: 'done', output, steps });
        return;
      }

      // Opened before anything is logged, so a server with no copilot fails
      // the run with its reason rather than after a half-written transcript.
      const model = await this.modelFor(agent, harness);

      // An agent given file tools, in a workspace with a folder bound, runs
      // the tool loop; everything else keeps the original text-only path.
      const fileTools = agent.tools.filter(name =>
        FILE_TOOL_NAMES.includes(name)
      );
      const useTools = fileTools.length > 0 && this.fileTools.available;

      if (useTools) {
        yield record(logLine(`▶ ${agent.name} ${harness}, with ${fileTools.join(', ')}`));
        for await (const event of this.runWithTools(
          agent,
          model,
          context.text,
          fileTools,
          controller.signal
        )) {
          if (event.type === 'step') steps = event.index + 1;
          if (event.type === 'text') output += event.delta;
          if (event.type === 'done') output = event.output;
          yield record(event);
        }

        if (controller.signal.aborted) {
          log += cancelledLine();
          this.runsStore.finish(runId, { status: 'cancelled', steps });
          return;
        }
        this.runsStore.finish(runId, { status: 'done', steps, output });
        return;
      }

      yield { type: 'step', index: 0 };
      yield record(
        logLine(`▶ ${agent.name} ${harness} · reading ${context.text.length} characters`)
      );

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

      for await (const delta of model(messages, controller.signal)) {
        output += delta;
        log += delta;
        yield { type: 'text', delta };
      }
      if (output && !output.endsWith('\n')) log += '\n';

      if (controller.signal.aborted) {
        log += cancelledLine();
        this.runsStore.finish(runId, { status: 'cancelled', steps: 1 });
        return;
      }

      this.runsStore.finish(runId, { status: 'done', steps: 1, output });
      yield { type: 'done', output };
    } catch (err) {
      // An abort surfaces as a throw from the stream; that's a cancel, not a
      // failure, and shouldn't be recorded as one.
      if (controller.signal.aborted) {
        if (harness !== 'remote') log += cancelledLine();
        this.runsStore.finish(runId, { status: 'cancelled', steps: 1 });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      yield record(logLine(`✗ ${message}`));
      this.runsStore.finish(runId, { status: 'error', steps: 1, error: message });
      yield { type: 'error', message };
    } finally {
      if (log) {
        this.runLogs.put(runId, log).catch(() => {
          // Losing a transcript must not fail the run it describes.
        });
      }
      if (deadline) clearTimeout(deadline);
      signal.removeEventListener('abort', onOuterAbort);
      this.inFlight.delete(key);
    }
  }

  /**
   * Run on a machine from the device inventory.
   *
   * The job is queued and the device claims it; this never connects to the
   * machine. Progress arrives by polling the job, which is why the event
   * stream here is coarser than the on-device one -- status changes rather
   * than token deltas.
   */
  private async *runRemote(
    runId: string,
    agent: Agent,
    context: string,
    signal: AbortSignal
  ): AsyncIterable<AgentEvent> {
    const workspaceId = this.workspaceId;
    if (!workspaceId) {
      throw new Error('No workspace is open, so there is nowhere to queue the run.');
    }
    if (!agent.deviceKey) {
      throw new Error(
        `"${agent.name}" has no device selected. Pick one in Settings → Agents.`
      );
    }

    const job = await this.remoteRunner.enqueue(workspaceId, {
      deviceKey: agent.deviceKey,
      agentId: agent.id,
      agentName: agent.name,
      instructions: agent.instructions,
      context,
      model: agent.model,
      tools: agent.tools,
      maxSteps: agent.maxSteps,
    });
    this.runsStore.attachRemote(runId, job.id, agent.deviceKey);

    yield { type: 'text', delta: `Queued on ${agent.deviceKey}…\n` };

    for await (const { job: update, logDelta } of this.remoteRunner.watch(
      workspaceId,
      job.id,
      signal
    )) {
      if (logDelta) yield { type: 'log', text: logDelta };
      yield { type: 'waiting', jobId: job.id, questions: openQuestions(update) };
      if (update.status === 'running') {
        yield { type: 'step', index: Math.max(0, update.steps - 1) };
        continue;
      }
      if (update.status === 'done') {
        yield { type: 'done', output: update.result ?? '' };
        return;
      }
      if (update.status === 'error') {
        throw new Error(update.error || `The run failed on ${agent.deviceKey}.`);
      }
      if (update.status === 'cancelled') {
        throw new Error('The run was cancelled.');
      }
    }
  }
}

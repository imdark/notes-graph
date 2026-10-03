import { LiveData, Service } from '@notesgraph/infra';

import type { Agent } from '../stores/agents';
import type { RemoteQuestion } from './remote-runner';
import { AgentAlreadyRunningError, type AgentExecutorService } from './executor';
import type { AgentTarget } from './target';

export interface AgentRunSession {
  /** The run record, once the executor has made one. */
  runId: string | null;
  agentId: string;
  agentName: string;
  agentEmoji?: string;
  target: AgentTarget;
  /** What was targeted, in words, for the panel header. */
  targetLabel: string;
  output: string;
  /** Transcript so far — tool calls, results, the answer. */
  log: string;
  /** The device job, for a remote run; what questions are answered against. */
  remoteJobId: string | null;
  /** What the run is waiting for the reader to answer. */
  questions: RemoteQuestion[];
  error: string | null;
  running: boolean;
}

const targetLabel = (target: AgentTarget): string => {
  switch (target.kind) {
    case 'block':
      return 'the selected block';
    case 'selection':
      return `${target.blockIds.length} selected blocks`;
    case 'doc':
      return 'this note';
  }
};

/**
 * The one agent run the reader is currently looking at.
 *
 * Runs can be started from places that have nowhere to show a result — the
 * slash menu closes the moment it's used — so the run lives here and the
 * Agents side panel renders it. Starting a run from the editor therefore means
 * "start it and open the panel", not "build a second piece of run UI".
 */
export class AgentRunSessionService extends Service {
  constructor(private readonly executor: AgentExecutorService) {
    super();
  }

  readonly session$ = new LiveData<AgentRunSession | null>(null);

  private controller: AbortController | null = null;

  /**
   * Start a run and stream it into {@link session$}. Resolves when the run
   * ends; callers that just want the panel to light up can ignore the promise.
   */
  async start(agent: Agent, target: AgentTarget): Promise<void> {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;

    this.session$.setValue({
      runId: null,
      agentId: agent.id,
      agentName: agent.name,
      agentEmoji: agent.emoji,
      target,
      targetLabel: targetLabel(target),
      output: '',
      log: '',
      remoteJobId: null,
      questions: [],
      error: null,
      running: true,
    });

    const patch = (fn: (prev: AgentRunSession) => AgentRunSession) => {
      const prev = this.session$.value;
      // A newer run has taken over; this one's events are stale.
      if (!prev || prev.agentId !== agent.id) return;
      this.session$.setValue(fn(prev));
    };

    try {
      for await (const event of this.executor.run(
        agent,
        target,
        controller.signal
      )) {
        if (event.type === 'started') {
          patch(prev => ({ ...prev, runId: event.runId }));
        } else if (event.type === 'waiting') {
          patch(prev => ({
            ...prev,
            remoteJobId: event.jobId,
            questions: event.questions,
          }));
        } else if (event.type === 'log') {
          patch(prev => ({ ...prev, log: prev.log + event.text }));
        } else if (event.type === 'text') {
          patch(prev => ({ ...prev, output: prev.output + event.delta }));
        } else if (event.type === 'error') {
          patch(prev => ({ ...prev, error: event.message }));
        }
      }
    } catch (err) {
      const message =
        err instanceof AgentAlreadyRunningError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      patch(prev => ({ ...prev, error: message }));
    } finally {
      if (this.controller === controller) this.controller = null;
      patch(prev => ({ ...prev, running: false, questions: [] }));
    }
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
  }

  clear(): void {
    this.cancel();
    this.session$.setValue(null);
  }
}

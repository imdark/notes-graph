import { LiveData, Service } from '@notesgraph/infra';

import type { Agent } from '../stores/agents';
import type { RemoteQuestion } from './remote-runner';
import { AgentAlreadyRunningError, type AgentExecutorService } from './executor';
import { type AgentTarget, agentTargetKey } from './target';

/** A run asked for while another was going, waiting its turn. */
export interface QueuedAgentRun {
  id: string;
  agent: Agent;
  target: AgentTarget;
  targetLabel: string;
}

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
 *
 * Asking for a run while one is going queues it rather than replacing it:
 * working down a task list means picking the next block while the agent is
 * still on the last one, and that must not throw the last one away.
 */
export class AgentRunSessionService extends Service {
  constructor(private readonly executor: AgentExecutorService) {
    super();
  }

  readonly session$ = new LiveData<AgentRunSession | null>(null);

  /** Runs waiting for the current one to end, oldest first. */
  readonly queue$ = new LiveData<QueuedAgentRun[]>([]);

  /** Aborts the current run; cleared once it is stopped or ends. */
  private controller: AbortController | null = null;
  /** The run {@link session$} shows, kept after a stop so its end still lands. */
  private active: AbortController | null = null;
  private nextQueueId = 0;

  private get busy(): boolean {
    return this.session$.value?.running ?? false;
  }

  private isPending(agent: Agent, target: AgentTarget): boolean {
    const key = agentTargetKey(target);
    const same = (agentId: string, t: AgentTarget) =>
      agentId === agent.id && agentTargetKey(t) === key;
    const session = this.session$.value;
    return (
      (!!session?.running && same(session.agentId, session.target)) ||
      this.queue$.value.some(run => same(run.agent.id, run.target))
    );
  }

  /**
   * Run now if nothing is going, otherwise queue behind what is. Resolves
   * when this run ends; callers that just want the panel to light up can
   * ignore the promise. Asking again for a run already going or queued does
   * nothing.
   */
  async start(agent: Agent, target: AgentTarget): Promise<void> {
    if (this.isPending(agent, target)) return;
    if (this.busy) {
      this.queue$.setValue([
        ...this.queue$.value,
        {
          id: `q${++this.nextQueueId}`,
          agent,
          target,
          targetLabel: targetLabel(target),
        },
      ]);
      return;
    }
    await this.runNow(agent, target);
  }

  /** Take a run out of the queue before it starts. */
  dequeue(id: string): void {
    this.queue$.setValue(this.queue$.value.filter(run => run.id !== id));
  }

  private runNext(): void {
    const [next, ...rest] = this.queue$.value;
    if (!next) return;
    this.queue$.setValue(rest);
    void this.runNow(next.agent, next.target);
  }

  private async runNow(agent: Agent, target: AgentTarget): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    this.active = controller;

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
      // The session was dismissed or a newer run has taken over; this one's
      // events are stale.
      if (!prev || this.active !== controller) return;
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
      if (this.active === controller) this.runNext();
    }
  }

  /** Stop the current run; the next queued one, if any, starts. */
  cancel(): void {
    this.controller?.abort();
    this.controller = null;
  }

  /** Stop everything: the current run and all that are queued. */
  cancelAll(): void {
    this.queue$.setValue([]);
    this.cancel();
  }

  clear(): void {
    this.cancelAll();
    this.active = null;
    this.session$.setValue(null);
  }
}

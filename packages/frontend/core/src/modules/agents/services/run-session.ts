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
  /** This session, for stopping or dismissing it; not the run record. */
  id: string;
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
  /** On the tab's own model, so other on-device runs queue behind it. */
  onDevice: boolean;
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

const runKey = (agentId: string, target: AgentTarget) =>
  `${agentId}:${agentTargetKey(target)}`;

/**
 * The agent runs the reader is looking at.
 *
 * Runs can be started from places that have nowhere to show a result — the
 * slash menu closes the moment it's used — so the runs live here and the
 * Agents side panel renders them. Starting a run from the editor therefore
 * means "start it and open the panel", not "build a second piece of run UI".
 *
 * Runs go side by side: working down a task list means picking the next
 * block while the agent is still on the last one. A device run gets its own
 * worktree and a cloud run is a server request, so those start at once. The
 * exception is the on-device model — one engine in the tab, which can only
 * answer one run at a time — so an on-device run asked for while another is
 * going queues behind it.
 */
export class AgentRunSessionService extends Service {
  constructor(private readonly executor: AgentExecutorService) {
    super();
  }

  /** Runs going or finished and not yet dismissed, oldest first. */
  readonly sessions$ = new LiveData<AgentRunSession[]>([]);

  /** On-device runs waiting for the one going to end, oldest first. */
  readonly queue$ = new LiveData<QueuedAgentRun[]>([]);

  /** Aborts each running session; cleared once it is stopped or ends. */
  private readonly controllers = new Map<string, AbortController>();
  private nextId = 0;

  /** Whether this agent's runs wait their turn rather than going at once. */
  queues(agent: Agent): boolean {
    return this.executor.harnessFor(agent) === 'on-device';
  }

  /** Whether an on-device run is going, so another would queue. */
  get onDeviceBusy(): boolean {
    return this.sessions$.value.some(
      session => session.running && session.onDevice
    );
  }

  private isPending(agent: Agent, target: AgentTarget): boolean {
    const key = runKey(agent.id, target);
    return (
      this.sessions$.value.some(
        session =>
          session.running && runKey(session.agentId, session.target) === key
      ) || this.queue$.value.some(run => runKey(run.agent.id, run.target) === key)
    );
  }

  /**
   * Run now, or queue behind the on-device run that's going. Resolves when
   * this run ends; callers that just want the panel to light up can ignore
   * the promise. Asking again for a run already going or queued does nothing.
   */
  async start(agent: Agent, target: AgentTarget): Promise<void> {
    if (this.isPending(agent, target)) return;
    if (this.queues(agent) && this.onDeviceBusy) {
      this.queue$.setValue([
        ...this.queue$.value,
        {
          id: `q${++this.nextId}`,
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
    const id = `s${++this.nextId}`;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const onDevice = this.queues(agent);

    // The last run of this agent on this target has ended; this one takes
    // its place rather than stacking up beside it.
    const key = runKey(agent.id, target);
    this.sessions$.setValue([
      ...this.sessions$.value.filter(
        session => runKey(session.agentId, session.target) !== key
      ),
      {
        id,
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
        onDevice,
      },
    ]);

    const patch = (fn: (prev: AgentRunSession) => AgentRunSession) => {
      // A dismissed session's events are stale.
      const sessions = this.sessions$.value;
      const index = sessions.findIndex(session => session.id === id);
      if (index < 0) return;
      const next = sessions.slice();
      next[index] = fn(sessions[index]);
      this.sessions$.setValue(next);
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
      this.controllers.delete(id);
      patch(prev => ({ ...prev, running: false, questions: [] }));
      if (onDevice) this.runNext();
    }
  }

  /** Stop one run; if it was on-device, the next queued one starts. */
  cancel(id: string): void {
    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
  }

  /** Stop everything: every run going and all that are queued. */
  cancelAll(): void {
    this.queue$.setValue([]);
    for (const id of [...this.controllers.keys()]) this.cancel(id);
  }

  /** Take a session off the panel, stopping it if it is still going. */
  dismiss(id: string): void {
    this.cancel(id);
    this.sessions$.setValue(
      this.sessions$.value.filter(session => session.id !== id)
    );
  }

  clear(): void {
    this.cancelAll();
    this.sessions$.setValue([]);
  }
}

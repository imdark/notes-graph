import { LiveData, Service } from '@notesgraph/infra';

import { type Agent, type AgentKind, agentKind } from '../stores/agents';
import type { RemoteQuestion } from './remote-runner';
import {
  AgentAlreadyRunningError,
  type AgentExecutorService,
} from './executor';
import { type AgentBlockRef, lastBlockTouched } from './focus-block';
import {
  type AgentTarget,
  agentTargetBlockIds,
  agentTargetKey,
} from './target';
import type { AgentTaskClaimService } from './task-claim';

/** A run asked for while another was going, waiting its turn. */
export interface QueuedAgentRun {
  id: string;
  agent: Agent;
  target: AgentTarget;
  targetLabel: string;
  /** Which run over the target's task list this is; see `continueList`. */
  pass: number;
}

/**
 * Most runs over one task list before it stops, however many tasks each
 * finishes, so a list that keeps growing can't keep an agent going forever.
 */
const MAX_LIST_PASSES = 10;

export interface AgentRunSession {
  /** This session, for stopping or dismissing it; not the run record. */
  id: string;
  /** The run record, once the executor has made one. */
  runId: string | null;
  agentId: string;
  agentName: string;
  agentEmoji?: string;
  /** Whether the output is an answer to keep or a report on work done. */
  agentKind: AgentKind;
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
  /**
   * The block the run is on: the last one a tool call named, else the block
   * it was started on. What the run card's Show link jumps to.
   */
  focus: AgentBlockRef | null;
}

const targetFocus = (target: AgentTarget): AgentBlockRef | null => {
  switch (target.kind) {
    case 'block':
      return { docId: target.docId, blockId: target.blockId };
    case 'selection':
      return target.blockIds[0]
        ? { docId: target.docId, blockId: target.blockIds[0] }
        : null;
    case 'doc':
      return null;
  }
};

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

/** The label once the task it is on has been read: the task, by its text. */
const titledLabel = (target: AgentTarget, title: string): string => {
  const more = agentTargetBlockIds(target).length - 1;
  return more > 0 ? `“${title}” and ${more} more` : `“${title}”`;
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
  constructor(
    private readonly executor: AgentExecutorService,
    private readonly taskClaim: AgentTaskClaimService
  ) {
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
      ) ||
      this.queue$.value.some(run => runKey(run.agent.id, run.target) === key)
    );
  }

  /**
   * Run now, or queue behind the on-device run that's going. Resolves when
   * this run ends; callers that just want the panel to light up can ignore
   * the promise. Asking again for a run already going or queued does nothing.
   *
   * The tasks it is on are marked queued straight away, before any work, so
   * another agent working the same list leaves them alone.
   */
  async start(agent: Agent, target: AgentTarget): Promise<void> {
    await this.schedule(agent, target, 1);
  }

  /** {@link start}, for the `pass`th run over the target's task list. */
  private async schedule(
    agent: Agent,
    target: AgentTarget,
    pass: number
  ): Promise<void> {
    if (this.isPending(agent, target)) return;
    this.claim(target);
    this.name(agent, target);
    if (this.queues(agent) && this.onDeviceBusy) {
      this.queue$.setValue([
        ...this.queue$.value,
        {
          id: `q${++this.nextId}`,
          agent,
          target,
          targetLabel: targetLabel(target),
          pass,
        },
      ]);
      return;
    }
    await this.runNow(agent, target, targetLabel(target), pass);
  }

  /** Take a run out of the queue before it starts. */
  dequeue(id: string): void {
    const run = this.queue$.value.find(run => run.id === id);
    this.queue$.setValue(this.queue$.value.filter(run => run.id !== id));
    if (run) this.unclaim(run.target);
  }

  private claim(target: AgentTarget): void {
    this.taskClaim.markQueued(target).catch(() => {
      // A run must not fail because its task couldn't be marked.
    });
  }

  /**
   * Label the run — queued or going — by the task it is on, once its text is
   * read, so a list of runs down a task list reads as the tasks themselves.
   */
  private name(agent: Agent, target: AgentTarget): void {
    if (target.kind === 'doc') return;
    const key = runKey(agent.id, target);
    this.taskClaim
      .titleOf(target)
      .then(title => {
        if (!title) return;
        const targetLabel = titledLabel(target, title);
        this.queue$.setValue(
          this.queue$.value.map(run =>
            runKey(run.agent.id, run.target) === key
              ? { ...run, targetLabel }
              : run
          )
        );
        this.sessions$.setValue(
          this.sessions$.value.map(session =>
            runKey(session.agentId, session.target) === key
              ? { ...session, targetLabel }
              : session
          )
        );
      })
      .catch(() => {
        // The generic label stands.
      });
  }

  /** Whether any agent's run is going or queued on this target. */
  isBusyOn(target: AgentTarget): boolean {
    const key = agentTargetKey(target);
    return (
      this.sessions$.value.some(
        session => session.running && agentTargetKey(session.target) === key
      ) || this.queue$.value.some(run => agentTargetKey(run.target) === key)
    );
  }

  /** Hand back tasks the run never moved on from queued. */
  private unclaim(target: AgentTarget): void {
    this.taskClaim.release(target, () => this.isBusyOn(target)).catch(() => {});
  }

  private runNext(): void {
    const [next, ...rest] = this.queue$.value;
    if (!next) return;
    this.queue$.setValue(rest);
    void this.runNow(next.agent, next.target, next.targetLabel, next.pass);
  }

  private async runNow(
    agent: Agent,
    target: AgentTarget,
    label: string,
    pass: number
  ): Promise<void> {
    const id = `s${++this.nextId}`;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const onDevice = this.queues(agent);
    // What was left to do as the run started, to tell whether it got any of
    // it done.
    const before = this.taskClaim.unfinished(target).catch((): string[] => []);
    let answered = false;

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
        agentKind: agentKind(agent),
        target,
        targetLabel: label,
        output: '',
        log: '',
        remoteJobId: null,
        questions: [],
        error: null,
        running: true,
        onDevice,
        focus: targetFocus(target),
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
          patch(prev => {
            const log = prev.log + event.text;
            // A remote log arrives in chunks that can split a line, so look
            // from the start of the line the new text continues.
            const touched = lastBlockTouched(
              log.slice(prev.log.lastIndexOf('\n') + 1),
              target.docId
            );
            return { ...prev, log, focus: touched ?? prev.focus };
          });
        } else if (event.type === 'text') {
          patch(prev => ({ ...prev, output: prev.output + event.delta }));
        } else if (event.type === 'error') {
          patch(prev => ({ ...prev, error: event.message }));
        } else if (event.type === 'done') {
          answered = true;
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
      patch(prev => ({ ...prev, running: false, questions: [] }));
      if (onDevice) this.runNext();
      if (answered && !controller.signal.aborted) {
        // The controller stays registered until the list is settled, so
        // stopping or dismissing the run also stops the next pass.
        void this.continueList(id, controller, agent, target, before, pass);
      } else {
        this.controllers.delete(id);
        this.unclaim(target);
      }
    }
  }

  /**
   * Work a task list until it is done: once a run over it ends, run again
   * while tasks are still open and the run just ended finished some. A run
   * that finished none ends the loop, since another would only repeat it;
   * so does stopping or dismissing the run.
   */
  private async continueList(
    sessionId: string,
    controller: AbortController,
    agent: Agent,
    target: AgentTarget,
    before: Promise<string[]>,
    pass: number
  ): Promise<void> {
    let again = false;
    try {
      const [was, left] = await Promise.all([
        before,
        this.taskClaim.unfinished(target, true),
      ]);
      again =
        !controller.signal.aborted &&
        this.sessions$.value.some(session => session.id === sessionId) &&
        left.length > 0 &&
        left.length < was.length &&
        pass < MAX_LIST_PASSES;
    } catch {
      // The list couldn't be read; leave it as the run left it.
    } finally {
      this.controllers.delete(sessionId);
    }
    if (again) {
      await this.schedule(agent, target, pass + 1);
    } else {
      this.unclaim(target);
    }
  }

  /** Stop one run; if it was on-device, the next queued one starts. */
  cancel(id: string): void {
    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
  }

  /** Stop everything: every run going and all that are queued. */
  cancelAll(): void {
    for (const run of this.queue$.value) this.unclaim(run.target);
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

/**
 * @vitest-environment happy-dom
 */
import { Framework } from '@notesgraph/infra';
import { describe, expect, test } from 'vitest';

import type { Agent } from '../stores/agents';
import { type AgentEvent, AgentExecutorService } from './executor';
import { AgentRunSessionService } from './run-session';
import type { AgentTarget } from './target';
import { AgentTaskClaimService } from './task-claim';

const agent = { id: 'a1', name: 'Worker' } as Agent;
const remote = {
  id: 'a2',
  name: 'Device worker',
  harness: 'remote',
} as Agent;
const cloud = { id: 'a3', name: 'Cloud worker', harness: 'cloud' } as Agent;
const block = (blockId: string): AgentTarget => ({
  kind: 'block',
  docId: 'doc',
  blockId,
});

/**
 * An executor whose runs stay open until the test ends them, recording which
 * block each run was on and whether it was aborted.
 */
const fakeExecutor = () => {
  const runs: {
    agentId: string;
    blockId: string;
    signal: AbortSignal;
    finish: () => void;
  }[] = [];
  const executor = {
    harnessFor: (a: Agent) => a.harness ?? 'on-device',
    async *run(
      a: Agent,
      target: AgentTarget,
      signal: AbortSignal
    ): AsyncIterable<AgentEvent> {
      let finish!: () => void;
      const ended = new Promise<void>(resolve => (finish = resolve));
      signal.addEventListener('abort', () => finish());
      runs.push({
        agentId: a.id,
        blockId: target.kind === 'block' ? target.blockId : '',
        signal,
        finish,
      });
      yield { type: 'started', runId: `run-${runs.length}` };
      await ended;
    },
  };
  const { calls, claimedAgain, claim } = fakeClaim();
  const framework = new Framework();
  framework.service(AgentExecutorService, executor as any);
  framework.service(AgentTaskClaimService, claim as any);
  framework.service(AgentRunSessionService, [
    AgentExecutorService,
    AgentTaskClaimService,
  ]);
  return {
    runs,
    calls,
    claimedAgain,
    sessions: framework.provider().get(AgentRunSessionService),
  };
};

/** Records what was claimed and handed back, without touching a doc. */
const fakeClaim = () => {
  const calls: { op: 'claim' | 'start' | 'release'; target: AgentTarget }[] =
    [];
  const claimedAgain: (() => boolean)[] = [];
  const started: Promise<string[]>[] = [];
  const claim = {
    markQueued: async (target: AgentTarget) => {
      calls.push({ op: 'claim', target });
    },
    markStarted: async (target: AgentTarget) => {
      calls.push({ op: 'start', target });
      return target.kind === 'block' ? [target.blockId] : [];
    },
    release: async (
      target: AgentTarget,
      again: () => boolean,
      moved: Promise<string[]> = Promise.resolve([])
    ) => {
      calls.push({ op: 'release', target });
      claimedAgain.push(again);
      started.push(moved);
    },
    titleOf: async (target: AgentTarget) =>
      target.kind === 'block' ? `Task ${target.blockId}` : null,
  };
  return { calls, claimedAgain, started, claim };
};

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('AgentRunSessionService', () => {
  test('device and cloud runs go side by side', async () => {
    const { runs, sessions } = fakeExecutor();

    void sessions.start(remote, block('b1'));
    void sessions.start(remote, block('b2'));
    void sessions.start(cloud, block('b3'));
    void sessions.start(agent, block('b4'));
    await tick();

    expect(runs.map(r => r.blockId)).toEqual(['b1', 'b2', 'b3', 'b4']);
    expect(sessions.queue$.value).toEqual([]);
    expect(sessions.sessions$.value.map(s => s.running)).toEqual([
      true,
      true,
      true,
      true,
    ]);

    // Ending one leaves the others going.
    runs[1].finish();
    await tick();
    expect(
      sessions.sessions$.value.filter(s => s.running).map(s => s.target)
    ).toEqual([block('b1'), block('b3'), block('b4')]);
  });

  test('stopping one run leaves the others going', async () => {
    const { runs, sessions } = fakeExecutor();

    void sessions.start(remote, block('b1'));
    void sessions.start(remote, block('b2'));
    await tick();
    sessions.cancel(sessions.sessions$.value[0].id);
    await tick();

    expect(runs.map(r => r.signal.aborted)).toEqual([true, false]);
  });

  test('an on-device run asked for while one is going queues', async () => {
    const { runs, sessions } = fakeExecutor();

    void sessions.start(agent, block('b1'));
    await tick();
    void sessions.start(agent, block('b2'));
    await tick();

    expect(runs.map(r => r.blockId)).toEqual(['b1']);
    expect(runs[0].signal.aborted).toBe(false);
    expect(sessions.queue$.value.map(r => r.target)).toEqual([block('b2')]);

    runs[0].finish();
    await tick();

    expect(runs.map(r => r.blockId)).toEqual(['b1', 'b2']);
    expect(sessions.queue$.value).toEqual([]);
    const last = sessions.sessions$.value.at(-1);
    expect(last?.target).toEqual(block('b2'));
    expect(last?.running).toBe(true);
  });

  test('runs and queued runs are labelled by the task they are on', async () => {
    const { runs, sessions } = fakeExecutor();

    void sessions.start(agent, block('b1'));
    void sessions.start(agent, block('b2'));
    void sessions.start(agent, {
      kind: 'selection',
      docId: 'doc',
      blockIds: ['b3', 'b4', 'b5'],
    });
    await tick();

    expect(sessions.sessions$.value[0].targetLabel).toBe('“Task b1”');
    expect(sessions.queue$.value.map(r => r.targetLabel)).toEqual([
      '“Task b2”',
      '3 selected blocks',
    ]);

    // The label it had while queued carries over once it starts.
    runs[0].finish();
    await tick();
    expect(sessions.sessions$.value.at(-1)?.targetLabel).toBe('“Task b2”');
  });

  test('asking again for a running or queued run does nothing', async () => {
    const { runs, sessions } = fakeExecutor();

    void sessions.start(agent, block('b1'));
    await tick();
    void sessions.start(agent, block('b1'));
    void sessions.start(agent, block('b2'));
    void sessions.start(agent, block('b2'));
    void sessions.start(remote, block('b3'));
    void sessions.start(remote, block('b3'));
    await tick();

    expect(runs).toHaveLength(2);
    expect(sessions.queue$.value).toHaveLength(1);
  });

  test('stop ends the on-device run and the next queued one starts', async () => {
    const { runs, sessions } = fakeExecutor();

    void sessions.start(agent, block('b1'));
    await tick();
    void sessions.start(agent, block('b2'));
    sessions.cancel(sessions.sessions$.value[0].id);
    await tick();

    expect(runs[0].signal.aborted).toBe(true);
    expect(runs.map(r => r.blockId)).toEqual(['b1', 'b2']);
  });

  test('stop all ends every run and drops the queue', async () => {
    const { runs, sessions } = fakeExecutor();

    void sessions.start(agent, block('b1'));
    void sessions.start(remote, block('b2'));
    await tick();
    void sessions.start(agent, block('b3'));
    sessions.cancelAll();
    await tick();

    expect(runs).toHaveLength(2);
    expect(runs.every(r => r.signal.aborted)).toBe(true);
    expect(sessions.queue$.value).toEqual([]);
    expect(sessions.sessions$.value.some(s => s.running)).toBe(false);
  });

  test('running again on the same target replaces the finished session', async () => {
    const { runs, sessions } = fakeExecutor();

    void sessions.start(remote, block('b1'));
    await tick();
    runs[0].finish();
    await tick();
    void sessions.start(remote, block('b1'));
    await tick();

    expect(sessions.sessions$.value).toHaveLength(1);
    expect(sessions.sessions$.value[0].running).toBe(true);
  });

  test('the focus follows the block the log says the agent is on', async () => {
    const log: string[] = [];
    let next!: () => void;
    const executor = {
      harnessFor: (a: Agent) => a.harness ?? 'on-device',
      async *run(): AsyncIterable<AgentEvent> {
        yield { type: 'started', runId: 'run-1' };
        while (log.length) {
          await new Promise<void>(resolve => (next = resolve));
          yield { type: 'log', text: log.shift() as string };
        }
      },
    };
    const framework = new Framework();
    framework.service(AgentExecutorService, executor as any);
    framework.service(AgentTaskClaimService, fakeClaim().claim as any);
    framework.service(AgentRunSessionService, [
      AgentExecutorService,
      AgentTaskClaimService,
    ]);
    const sessions = framework.provider().get(AgentRunSessionService);
    // A remote log can arrive cut mid-line.
    log.push('→ update_task  {"docId": "doc", "blo', 'ckId": "t2"}\n');

    void sessions.start(agent, { kind: 'doc', docId: 'doc' });
    await tick();
    expect(sessions.sessions$.value[0]?.focus).toBeNull();

    next();
    await tick();
    expect(sessions.sessions$.value[0]?.focus).toBeNull();

    next();
    await tick();
    expect(sessions.sessions$.value[0]?.focus).toEqual({
      docId: 'doc',
      blockId: 't2',
    });
  });

  test('a block run starts focused on its block', async () => {
    const { sessions } = fakeExecutor();
    void sessions.start(agent, block('b1'));
    await tick();
    expect(sessions.sessions$.value[0]?.focus).toEqual({
      docId: 'doc',
      blockId: 'b1',
    });
  });

  test('a queued run claims its task at once, before any work', async () => {
    const { runs, calls, sessions } = fakeExecutor();

    void sessions.start(agent, block('b1'));
    await tick();
    void sessions.start(agent, block('b2'));
    await tick();

    expect(runs.map(r => r.blockId)).toEqual(['b1']);
    expect(calls).toEqual([
      { op: 'claim', target: block('b1') },
      { op: 'claim', target: block('b2') },
    ]);
  });

  test('asking again for a pending run does not claim twice', async () => {
    const { calls, sessions } = fakeExecutor();

    void sessions.start(remote, block('b1'));
    void sessions.start(remote, block('b1'));
    await tick();

    expect(calls.filter(c => c.op === 'claim')).toHaveLength(1);
  });

  test('a run taken off the queue hands its task back', async () => {
    const { calls, sessions } = fakeExecutor();

    void sessions.start(agent, block('b1'));
    await tick();
    void sessions.start(agent, block('b2'));
    sessions.dequeue(sessions.queue$.value[0].id);
    await tick();

    expect(calls.at(-1)).toEqual({ op: 'release', target: block('b2') });
  });

  test('stop all hands back the queued runs too', async () => {
    const { calls, sessions } = fakeExecutor();

    void sessions.start(agent, block('b1'));
    await tick();
    void sessions.start(agent, block('b2'));
    sessions.cancelAll();
    await tick();

    expect(
      calls.filter(c => c.op === 'release').map(c => c.target)
    ).toEqual(expect.arrayContaining([block('b1'), block('b2')]));
  });

  test('a queued task goes in progress once the agent picks the run up', async () => {
    let pickUp!: () => void;
    let finish!: () => void;
    const executor = {
      harnessFor: (a: Agent) => a.harness ?? 'on-device',
      async *run(): AsyncIterable<AgentEvent> {
        yield { type: 'started', runId: 'run-1' };
        // A device run waits for the device to take its job.
        await new Promise<void>(resolve => (pickUp = resolve));
        yield { type: 'step', index: 0 };
        yield { type: 'step', index: 1 };
        await new Promise<void>(resolve => (finish = resolve));
      },
    };
    const { calls, started, claim } = fakeClaim();
    const framework = new Framework();
    framework.service(AgentExecutorService, executor as any);
    framework.service(AgentTaskClaimService, claim as any);
    framework.service(AgentRunSessionService, [
      AgentExecutorService,
      AgentTaskClaimService,
    ]);
    const sessions = framework.provider().get(AgentRunSessionService);

    void sessions.start(remote, block('b1'));
    await tick();
    expect(calls.map(c => c.op)).toEqual(['claim']);

    pickUp();
    await tick();
    // Once, however many steps follow.
    expect(calls.map(c => c.op)).toEqual(['claim', 'start']);

    finish();
    await tick();
    expect(calls.at(-1)).toEqual({ op: 'release', target: block('b1') });
    expect(await started.at(-1)).toEqual(['b1']);
  });

  test('a run that ends hands back its task unless asked for again', async () => {
    const { runs, calls, claimedAgain, sessions } = fakeExecutor();

    void sessions.start(remote, block('b1'));
    await tick();
    runs[0].finish();
    await tick();

    expect(calls.at(-1)).toEqual({ op: 'release', target: block('b1') });
    expect(claimedAgain.at(-1)?.()).toBe(false);

    void sessions.start(remote, block('b1'));
    await tick();
    expect(claimedAgain.at(-1)?.()).toBe(true);
  });
});

/**
 * @vitest-environment happy-dom
 */
import { Framework } from '@notesgraph/infra';
import { describe, expect, test } from 'vitest';

import type { Agent } from '../stores/agents';
import { type AgentEvent, AgentExecutorService } from './executor';
import { AgentRunSessionService } from './run-session';
import type { AgentTarget } from './target';

const agent = { id: 'a1', name: 'Worker' } as Agent;
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
    blockId: string;
    signal: AbortSignal;
    finish: () => void;
  }[] = [];
  const executor = {
    async *run(
      _agent: Agent,
      target: AgentTarget,
      signal: AbortSignal
    ): AsyncIterable<AgentEvent> {
      let finish!: () => void;
      const ended = new Promise<void>(resolve => (finish = resolve));
      signal.addEventListener('abort', () => finish());
      runs.push({
        blockId: target.kind === 'block' ? target.blockId : '',
        signal,
        finish,
      });
      yield { type: 'started', runId: `run-${runs.length}` };
      await ended;
    },
  };
  const framework = new Framework();
  framework.service(AgentExecutorService, executor as any);
  framework.service(AgentRunSessionService, [AgentExecutorService]);
  return { runs, sessions: framework.provider().get(AgentRunSessionService) };
};

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('AgentRunSessionService', () => {
  test('a run asked for while one is going queues instead of replacing it', async () => {
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
    expect(sessions.session$.value?.target).toEqual(block('b2'));
    expect(sessions.session$.value?.running).toBe(true);
  });

  test('asking again for a running or queued run does nothing', async () => {
    const { runs, sessions } = fakeExecutor();

    void sessions.start(agent, block('b1'));
    await tick();
    void sessions.start(agent, block('b1'));
    void sessions.start(agent, block('b2'));
    void sessions.start(agent, block('b2'));
    await tick();

    expect(runs).toHaveLength(1);
    expect(sessions.queue$.value).toHaveLength(1);
  });

  test('stop ends the current run and the next queued one starts', async () => {
    const { runs, sessions } = fakeExecutor();

    void sessions.start(agent, block('b1'));
    await tick();
    void sessions.start(agent, block('b2'));
    sessions.cancel();
    await tick();

    expect(runs[0].signal.aborted).toBe(true);
    expect(runs.map(r => r.blockId)).toEqual(['b1', 'b2']);
  });

  test('stop all ends the current run and drops the queue', async () => {
    const { runs, sessions } = fakeExecutor();

    void sessions.start(agent, block('b1'));
    await tick();
    void sessions.start(agent, block('b2'));
    sessions.cancelAll();
    await tick();

    expect(runs).toHaveLength(1);
    expect(sessions.queue$.value).toEqual([]);
    expect(sessions.session$.value?.running).toBe(false);
  });

  test('the focus follows the block the log says the agent is on', async () => {
    const log: string[] = [];
    let next!: () => void;
    const executor = {
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
    framework.service(AgentRunSessionService, [AgentExecutorService]);
    const sessions = framework.provider().get(AgentRunSessionService);
    // A remote log can arrive cut mid-line.
    log.push('→ update_task  {"docId": "doc", "blo', 'ckId": "t2"}\n');

    void sessions.start(agent, { kind: 'doc', docId: 'doc' });
    await tick();
    expect(sessions.session$.value?.focus).toBeNull();

    next();
    await tick();
    expect(sessions.session$.value?.focus).toBeNull();

    next();
    await tick();
    expect(sessions.session$.value?.focus).toEqual({
      docId: 'doc',
      blockId: 't2',
    });
  });

  test('a block run starts focused on its block', async () => {
    const { sessions } = fakeExecutor();
    void sessions.start(agent, block('b1'));
    await tick();
    expect(sessions.session$.value?.focus).toEqual({
      docId: 'doc',
      blockId: 'b1',
    });
  });
});

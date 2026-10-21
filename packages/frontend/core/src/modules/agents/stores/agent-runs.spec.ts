import { Framework } from '@notesgraph/infra';
import { describe, expect, test } from 'vitest';

import { WorkspaceDBService } from '../../db';
import { AgentRunLogsStore } from './agent-run-logs';
import { AgentRunsStore, formatRunCost } from './agent-runs';

/** A runs store over an in-memory table, counting the writes it makes. */
const setup = (rows: Record<string, Record<string, unknown>>) => {
  let writes = 0;
  const table = {
    get: (id: string) => rows[id],
    update: (id: string, patch: Record<string, unknown>) => {
      writes++;
      rows[id] = { ...rows[id], ...patch };
    },
    find: () => Object.values(rows),
    create: (row: Record<string, unknown>) => {
      const id = `r${Object.keys(rows).length + 1}`;
      rows[id] = { ...row, id };
      return rows[id];
    },
  };
  const framework = new Framework();
  framework
    .service(WorkspaceDBService, {
      userdataDB$: { value: { agentRuns: table } },
    } as any)
    .store(AgentRunLogsStore, {} as any)
    .store(AgentRunsStore, [WorkspaceDBService, AgentRunLogsStore]);
  const store = framework.provider().get(AgentRunsStore);
  return { store, rows, writes: () => writes };
};

describe('formatRunCost', () => {
  test('shows cents, and less than a cent as <$0.01', () => {
    expect(formatRunCost(0.42)).toBe('$0.42');
    expect(formatRunCost(3.2)).toBe('$3.20');
    expect(formatRunCost(0.004)).toBe('<$0.01');
    expect(formatRunCost(0)).toBe('<$0.01');
  });
});

describe('AgentRunsStore usage', () => {
  test('finish keeps what the run cost', () => {
    const { store, rows } = setup({ r1: { id: 'r1', startedAt: 0 } });
    store.finish(
      'r1',
      {
        status: 'done',
        steps: 2,
        output: 'ok',
        usage: { costUsd: 0.42, tokens: 900 },
      },
      1000
    );
    expect(rows.r1).toMatchObject({
      status: 'done',
      costUsd: 0.42,
      tokens: 900,
    });
  });

  test('finish without a reported cost leaves an earlier one in place', () => {
    const { store, rows } = setup({
      r1: { id: 'r1', startedAt: 0, costUsd: 0.1 },
    });
    store.finish(
      'r1',
      { status: 'cancelled', steps: 1, usage: { costUsd: null } },
      1000
    );
    expect(rows.r1.costUsd).toBe(0.1);
  });

  test('a run that finishes waits for review until it is approved', () => {
    const { store, rows } = setup({
      r1: { id: 'r1', startedAt: 0, status: 'running' },
      r2: { id: 'r2', startedAt: 0, status: 'running' },
      r3: { id: 'r3', startedAt: 0, status: 'running' },
    });
    store.finish('r1', { status: 'done', steps: 1, output: 'ok' }, 1000);
    store.finish('r2', { status: 'error', steps: 1, error: 'no' }, 1000);
    store.finish('r3', { status: 'cancelled', steps: 1 }, 1000);
    expect(rows.r1.reviewPending).toBe(true);
    expect(rows.r2.reviewPending).toBe(false);
    expect(rows.r3.reviewPending).toBe(false);

    store.settleReview('r1');
    expect(rows.r1.reviewPending).toBe(false);
  });

  test('a run that ended long ago and is settled again is not put up for review', () => {
    const { store, rows } = setup({
      r1: { id: 'r1', startedAt: 0, status: 'done' },
    });
    store.finish('r1', { status: 'done', steps: 1, output: 'ok' }, 1000);
    expect(rows.r1.reviewPending).toBeFalsy();
  });

  test('a new run of the agent on the note takes over the earlier review', () => {
    const { store, rows } = setup({
      r1: {
        id: 'r1',
        agentId: 'a',
        docId: 'd',
        startedAt: 0,
        reviewPending: true,
      },
      r2: {
        id: 'r2',
        agentId: 'b',
        docId: 'd',
        startedAt: 0,
        reviewPending: true,
      },
    });
    store.start({ id: 'a', name: 'A' }, { kind: 'doc', docId: 'd' });
    expect(rows.r1.reviewPending).toBe(false);
    expect(rows.r2.reviewPending).toBe(true);
  });

  test('setUsage writes only when the numbers change', () => {
    const { store, rows, writes } = setup({ r1: { id: 'r1', startedAt: 0 } });
    store.setUsage('r1', { costUsd: 0.2, tokens: 10 });
    store.setUsage('r1', { costUsd: 0.2, tokens: 10 });
    store.setUsage('r1', { costUsd: null, tokens: undefined });
    expect(writes()).toBe(1);
    expect(rows.r1).toMatchObject({ costUsd: 0.2, tokens: 10 });
  });
});

describe('AgentRunsStore ask chats', () => {
  const parent = {
    id: 'p',
    agentId: 'a',
    agentName: 'Doer',
    targetKind: 'block',
    docId: 'd',
    blockId: 'b',
    title: 'Fix the bug',
    status: 'error',
    startedAt: 0,
    harness: 'remote',
    deviceKey: 'mac',
  } as const;

  test('a chat is its own row about the run, on no blocks', () => {
    const { store, rows } = setup({ p: { ...parent } });
    const id = store.startAsk(parent);
    expect(rows[id]).toMatchObject({
      kind: 'ask',
      parentRunId: 'p',
      targetKind: 'ask',
      docId: 'd',
      title: 'Ask: Fix the bug',
      status: 'running',
      harness: 'remote',
    });
    expect(rows[id].blockId).toBeUndefined();
    expect(store.latestAsk('p')?.id).toBe(id);
    expect(store.targetOf(rows[id] as any)).toBeNull();
  });

  test('a chat keeps its error and is never put up for review', () => {
    const { store, rows } = setup({ p: { ...parent } });
    const id = store.startAsk(parent);
    store.finish(id, { status: 'error', steps: 0, error: 'Model offline' });
    expect(rows[id]).toMatchObject({ status: 'error', error: 'Model offline' });

    expect(store.resumeAsk(id)).toBe(true);
    expect(rows[id]).toMatchObject({ status: 'running', error: undefined });
    store.finish(id, { status: 'done', steps: 1, output: 'Because…' });
    expect(rows[id]).toMatchObject({ status: 'done', summary: 'Because…' });
    expect(rows[id].reviewPending).toBe(false);
  });

  test('a deleted chat cannot be resumed', () => {
    const { store } = setup({ p: { ...parent } });
    expect(store.resumeAsk('gone')).toBe(false);
    expect(store.latestAsk('p')).toBeUndefined();
  });
});

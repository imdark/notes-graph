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
      { status: 'done', steps: 2, output: 'ok', usage: { costUsd: 0.42, tokens: 900 } },
      1000
    );
    expect(rows.r1).toMatchObject({ status: 'done', costUsd: 0.42, tokens: 900 });
  });

  test('finish without a reported cost leaves an earlier one in place', () => {
    const { store, rows } = setup({ r1: { id: 'r1', startedAt: 0, costUsd: 0.1 } });
    store.finish('r1', { status: 'cancelled', steps: 1, usage: { costUsd: null } }, 1000);
    expect(rows.r1.costUsd).toBe(0.1);
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

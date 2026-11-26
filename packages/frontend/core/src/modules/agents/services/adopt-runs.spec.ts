import { describe, expect, test } from 'vitest';

import type { AgentRun } from '../stores/agent-runs';
import { ADOPT_WITHIN_MS, isLostStart, planAdoptions } from './adopt-runs';
import type { RemoteJob } from './remote-runner';

const NOW = Date.UTC(2026, 10, 26, 23, 0);

const job = (patch: Partial<RemoteJob> = {}): RemoteJob =>
  ({
    id: 'job-1',
    deviceKey: 'cloud',
    agentId: 'agent-1',
    agentName: 'cloud',
    status: 'done',
    docId: 'journal',
    blockId: 'todo-1',
    targetKind: 'block',
    createdAt: (NOW - 60 * 60_000) / 1000,
    ...patch,
  }) as RemoteJob;

const run = (patch: Partial<AgentRun> = {}): AgentRun => ({
  id: 'run-1',
  agentId: 'agent-1',
  agentName: 'cloud',
  targetKind: 'block',
  docId: 'journal',
  status: 'done',
  startedAt: NOW - 60 * 60_000,
  ...patch,
});

describe('taking on runs this browser has no record of', () => {
  test("adopts a job on a note that no run here has: another agent's subtask", () => {
    expect(planAdoptions([job()], [], NOW)).toEqual([
      { kind: 'adopt', job: expect.objectContaining({ id: 'job-1' }) },
    ]);
  });

  test('leaves jobs it already has, health checks and old jobs alone', () => {
    const plan = planAdoptions(
      [
        job({ id: 'mine' }),
        job({ id: 'health', docId: null }),
        job({ id: 'old', createdAt: (NOW - ADOPT_WITHIN_MS - 1) / 1000 }),
        job({ id: 'deleted' }),
      ],
      [run({ remoteJobId: 'mine' })],
      NOW,
      new Set(['deleted'])
    );
    expect(plan).toEqual([]);
  });

  test('a run that timed out starting gets its job back instead of a copy', () => {
    const lost = run({
      id: 'lost',
      status: 'error',
      error: 'Network error: timeout after 15000ms',
      startedAt: NOW - 60 * 60_000 - 5_000,
    });
    expect(isLostStart(lost)).toBe(true);
    const plan = planAdoptions([job()], [lost], NOW);
    expect(plan).toEqual([
      {
        kind: 'reattach',
        runId: 'lost',
        job: expect.objectContaining({ id: 'job-1' }),
      },
    ]);
  });

  test('a lost run only matches its own agent, note and start', () => {
    const lost = run({
      id: 'lost',
      status: 'error',
      error: 'Network error: timeout after 15000ms',
    });
    const plan = planAdoptions(
      [
        job({ id: 'other-agent', agentId: 'agent-2' }),
        job({ id: 'other-note', docId: 'elsewhere' }),
        job({ id: 'later', createdAt: (NOW - 10 * 60_000) / 1000 }),
      ],
      [lost],
      NOW
    );
    expect(plan.map(step => step.kind)).toEqual(['adopt', 'adopt', 'adopt']);
  });

  test('a run still starting here is not copied while its job id is on its way', () => {
    const starting = run({
      status: 'running',
      startedAt: NOW - 70 * 60_000 + 10_000,
    });
    expect(
      planAdoptions(
        [job({ createdAt: (NOW - 70 * 60_000) / 1000 })],
        [starting],
        NOW
      )
    ).toEqual([]);
  });

  test('a run that failed for another reason is not taken for a lost start', () => {
    expect(
      isLostStart(run({ status: 'error', error: 'The run failed.' }))
    ).toBe(false);
    expect(
      isLostStart(
        run({ status: 'error', error: 'Network error: x', remoteJobId: 'j' })
      )
    ).toBe(false);
  });
});

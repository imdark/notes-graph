/**
 * @vitest-environment happy-dom
 */
import { UserFriendlyError } from '@notesgraph/error';
import { describe, expect, test } from 'vitest';

import type { AgentRun } from '../stores/agent-runs';
import {
  ADOPT_WITHIN_MS,
  isLostFollow,
  isLostStart,
  planAdoptions,
} from './adopt-runs';
import { isTransient, type RemoteJob } from './remote-runner';

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

describe('runs a slow poll recorded as failed', () => {
  const followed = (patch: Partial<AgentRun> = {}) =>
    run({
      id: 'followed',
      status: 'error',
      error: 'Network error: timeout after 15000ms',
      remoteJobId: 'job-1',
      ...patch,
    });

  test('take how their job really went', () => {
    expect(isLostFollow(followed())).toBe(true);
    expect(planAdoptions([job({ status: 'done' })], [followed()], NOW)).toEqual(
      [
        {
          kind: 'resettle',
          runId: 'followed',
          job: expect.objectContaining({ id: 'job-1' }),
        },
      ]
    );
    expect(
      planAdoptions([job({ status: 'running' })], [followed()], NOW)[0].kind
    ).toBe('resettle');
  });

  test('keep their failure when the job failed too, or failed for another reason', () => {
    expect(
      planAdoptions([job({ status: 'error' })], [followed()], NOW)
    ).toEqual([]);
    expect(
      planAdoptions(
        [job({ status: 'done' })],
        [followed({ error: 'The run failed on its device.' })],
        NOW
      )
    ).toEqual([]);
  });
});

describe('what is worth retrying', () => {
  test('a request that gave up after its timeout (499) is', () => {
    const err = (status: number) =>
      new UserFriendlyError({
        status,
        code: 'X',
        type: 'X',
        name: 'X',
        message: 'Network error: timeout after 15000ms',
      } as any);
    expect(isTransient(err(499))).toBe(true);
    expect(isTransient(err(504))).toBe(true);
    expect(isTransient(err(404))).toBe(false);
    expect(isTransient(err(403))).toBe(false);
  });
});

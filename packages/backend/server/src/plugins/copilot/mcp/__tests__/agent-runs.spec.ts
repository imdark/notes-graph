import type { RegistryJob } from '@prisma/client';
import test from 'ava';

import { agentRunsAnswer, summarizeRun } from '../agent-runs';

/** What list_agent_runs says about each run, for a review of them. */

const now = new Date('2026-11-26T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

const job = (patch: Partial<RegistryJob> = {}): RegistryJob =>
  ({
    id: 'job-1',
    kind: 'agent',
    title: 'CLOUD-125 Lift sheets above the keyboard',
    agentName: 'cloud',
    deviceKey: 'cloud',
    status: 'done',
    createdAt: hoursAgo(2),
    finishedAt: hoursAgo(1),
    error: null,
    result: 'Committed the fix.',
    changes: null,
    log: '',
    ...patch,
  }) as RegistryJob;

test('a run with unpushed work shows its branch, commits and permission failures', t => {
  const summary = summarizeRun(
    job({
      changes: {
        notes: { created: [{}], edited: [{}, {}] },
        git: {
          branch: 'cloud-125-lift',
          commits: [{ sha: 'abc', subject: 'fix(android): lift sheets' }],
          stat: [{}, {}, {}],
        },
      } as never,
      log:
        'ran tests\n' +
        'Tool permission request failed: AbortError: Stream closed\n' +
        'Tool permission request failed: AbortError: Stream closed\n',
    })
  );
  t.deepEqual(summary.git, {
    branch: 'cloud-125-lift',
    commits: ['fix(android): lift sheets'],
    files: 3,
  });
  t.deepEqual(summary.notes, { created: 1, edited: 2 });
  t.is(summary.permissionFailures, 2);
  t.true(summary.logTail.endsWith('Stream closed\n'));
  t.is(summary.finishedAt, hoursAgo(1).toISOString());
});

test('long errors, results and logs are clipped', t => {
  const summary = summarizeRun(
    job({
      error: 'e'.repeat(1000),
      result: 'r'.repeat(2000),
      log: 'l'.repeat(5000),
    })
  );
  t.true((summary.error ?? '').length <= 401);
  t.true((summary.result ?? '').length <= 801);
  t.true(summary.logTail.length <= 601);
  t.true(summary.logTail.startsWith('…'));
});

test('keeps the agent runs started within the window, running ones too', t => {
  const answer = agentRunsAnswer(
    [
      job({
        id: 'running',
        status: 'running',
        finishedAt: null,
        createdAt: hoursAgo(1),
      }),
      job({ id: 'automation', kind: 'automation', createdAt: hoursAgo(1) }),
      job({ id: 'recent', createdAt: hoursAgo(30) }),
      job({ id: 'old', createdAt: hoursAgo(24 * 4) }),
    ],
    3,
    now
  );
  t.deepEqual(
    answer.runs.map(r => r.id),
    ['running', 'recent']
  );
  t.is(answer.count, 2);
  t.is(answer.since, hoursAgo(72).toISOString());
});

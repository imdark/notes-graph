import type { AgentRun, RemoteQuestion } from '@notesgraph/core/modules/agents';
import { describe, expect, test } from 'vitest';

import { approvalSummary, pendingApprovals } from './approve-all';

const run = (id: string, remoteJobId?: string) =>
  ({ id, remoteJobId, status: 'running' }) as AgentRun;

const permission = (id: string, tool: string): RemoteQuestion => ({
  id,
  kind: 'permission',
  text: `Allow ${tool}?`,
  detail: null,
  answer: null,
  allowed: null,
  createdAt: 0,
  answeredAt: null,
});

const question = (id: string): RemoteQuestion => ({
  id,
  kind: 'question',
  text: 'Which repo?',
  detail: null,
  answer: null,
  allowed: null,
  createdAt: 0,
  answeredAt: null,
});

describe('Approve all', () => {
  const questions: Record<string, RemoteQuestion[]> = {
    a: [permission('q1', 'Bash'), question('q2'), permission('q3', 'Edit')],
    b: [permission('q4', 'Bash')],
    c: [permission('q5', 'Write')],
  };
  const pending = pendingApprovals(
    [run('a', 'job-a'), run('b', 'job-b'), run('c')],
    r => questions[r.id]
  );

  test('takes every open permission request, not questions, from runs with a job', () => {
    expect(pending).toEqual([
      { runId: 'a', jobId: 'job-a', questionId: 'q1', tool: 'Bash' },
      { runId: 'a', jobId: 'job-a', questionId: 'q3', tool: 'Edit' },
      { runId: 'b', jobId: 'job-b', questionId: 'q4', tool: 'Bash' },
    ]);
  });

  test('sums them up for the confirm: how many, from how many runs, which tools', () => {
    expect(approvalSummary(pending)).toBe(
      '3 requests from 2 runs: Bash ×2, Edit'
    );
    expect(approvalSummary(pending.slice(0, 1))).toBe(
      '1 request from 1 run: Bash'
    );
  });
});

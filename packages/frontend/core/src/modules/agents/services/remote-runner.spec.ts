/**
 * @vitest-environment happy-dom
 */
import { FetchService } from '@notesgraph/core/modules/cloud/services/fetch';
import { WorkspaceServerService } from '@notesgraph/core/modules/cloud/services/workspace-server';
import { Framework } from '@notesgraph/infra';
import { describe, expect, test } from 'vitest';

import { RemoteAgentRunnerService, type RemoteJob } from './remote-runner';

const job = (overrides: Partial<RemoteJob>): RemoteJob => ({
  id: 'job-1',
  deviceKey: 'laptop',
  status: 'running',
  result: null,
  error: null,
  steps: 0,
  tmuxSession: 'wf-job-job-1',
  startedAt: null,
  finishedAt: null,
  ...overrides,
});

/**
 * A runner whose server answers `GET …/jobs/:id` from a script of replies,
 * one per poll, and records every request it saw.
 */
function createRunner(replies: ((logFrom: number) => RemoteJob)[]) {
  const requests: { url: string; method: string }[] = [];
  const fetchService = {
    fetch: async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method ?? 'GET' });
      if (init?.method === 'POST') {
        return new Response('{}', { status: 200 });
      }
      const logFrom = Number(new URL(url, 'http://x').searchParams.get('logFrom'));
      const reply = replies[Math.min(requests.filter(r => r.method === 'GET').length - 1, replies.length - 1)];
      return new Response(JSON.stringify({ job: reply(logFrom) }), { status: 200 });
    },
  };
  const workspaceServerService = {
    server: {
      scope: {
        get: (token: unknown) => {
          expect(token).toBe(FetchService);
          return fetchService;
        },
      },
    },
  };
  const framework = new Framework();
  framework.service(WorkspaceServerService, workspaceServerService as any);
  framework.service(RemoteAgentRunnerService, [WorkspaceServerService]);
  return { runner: framework.provider().get(RemoteAgentRunnerService), requests };
}

describe('RemoteAgentRunnerService.watch', () => {
  test('asks only for new transcript text and yields it as a delta', async () => {
    const { runner, requests } = createRunner([
      () => job({ log: '→ Read\n', logFrom: 0, logEnd: 7 }),
      () => job({ status: 'done', result: 'ok', log: '✓ done\n', logFrom: 7, logEnd: 14 }),
    ]);

    const updates = [];
    for await (const update of runner.watch('ws-1', 'job-1', new AbortController().signal)) {
      updates.push(update);
    }

    expect(updates.map(u => u.logDelta)).toEqual(['→ Read\n', '✓ done\n']);
    expect(updates.at(-1)?.job.status).toBe('done');
    expect(updates[0].job.tmuxSession).toBe('wf-job-job-1');
    expect(requests.map(r => r.url)).toEqual([
      '/api/inventory/workspaces/ws-1/jobs/job-1?logFrom=0',
      '/api/inventory/workspaces/ws-1/jobs/job-1?logFrom=7',
    ]);
  });

  test('a viewer closing the log does not cancel the run', async () => {
    const { runner, requests } = createRunner([
      () => job({ log: 'working\n', logFrom: 0, logEnd: 8 }),
    ]);
    const controller = new AbortController();

    for await (const _ of runner.watch('ws-1', 'job-1', controller.signal, {
      cancelOnAbort: false,
    })) {
      controller.abort();
    }

    expect(requests.some(r => r.url.endsWith('/cancel'))).toBe(false);
  });

  test('the tab that started a run cancels it on abort', async () => {
    const { runner, requests } = createRunner([
      () => job({ log: 'working\n', logFrom: 0, logEnd: 8 }),
    ]);
    const controller = new AbortController();

    for await (const _ of runner.watch('ws-1', 'job-1', controller.signal)) {
      controller.abort();
    }

    expect(requests.at(-1)).toEqual({
      url: '/api/inventory/workspaces/ws-1/jobs/job-1/cancel',
      method: 'POST',
    });
  });
});

/**
 * @vitest-environment happy-dom
 */
import { FetchService } from '@notesgraph/core/modules/cloud/services/fetch';
import { WorkspaceServerService } from '@notesgraph/core/modules/cloud/services/workspace-server';
import { Framework } from '@notesgraph/infra';
import { describe, expect, test } from 'vitest';

import {
  CLOUD_DEVICE_KEY,
  deviceHarnessName,
  editorHarness,
  isDeviceClaudeModel,
  openQuestions,
  RemoteAgentRunnerService,
  type RemoteJob,
  RESEARCH_MODEL,
  savedPlacement,
} from './remote-runner';

describe('device harnesses', () => {
  test('research runs Claude Code on the device, named as such', () => {
    expect(isDeviceClaudeModel(RESEARCH_MODEL)).toBe(true);
    expect(deviceHarnessName(RESEARCH_MODEL)).toBe('Research');
    expect(deviceHarnessName('claude-code')).toBe('Claude Code');
    expect(deviceHarnessName('workflow')).toBe('Workflow');
    expect(deviceHarnessName('Llama-3.2-1B-Instruct-q4f16_1-MLC')).toBeNull();
  });
});

describe('Claude Code under Cloud', () => {
  test("is saved as the server's runner and reads back as Cloud", () => {
    const saved = savedPlacement('cloud', 'claude-code', undefined);
    expect(saved).toEqual({
      harness: 'remote',
      model: 'claude-code',
      deviceKey: CLOUD_DEVICE_KEY,
    });
    expect(editorHarness(saved.harness, saved.model, saved.deviceKey)).toBe(
      'cloud'
    );
  });

  test('a copilot model on Cloud stays a copilot run', () => {
    expect(savedPlacement('cloud', 'gpt-5', 'laptop')).toEqual({
      harness: 'cloud',
      model: 'gpt-5',
      deviceKey: undefined,
    });
  });

  test('device-only models are dropped off the browser runtime', () => {
    expect(savedPlacement('on-device', 'workflow', undefined)).toEqual({
      harness: 'on-device',
      model: undefined,
      deviceKey: undefined,
    });
  });

  test('a real device keeps its key and reads back as Remote', () => {
    const saved = savedPlacement('remote', 'claude-code', 'laptop');
    expect(saved).toEqual({
      harness: 'remote',
      model: 'claude-code',
      deviceKey: 'laptop',
    });
    expect(editorHarness(saved.harness, saved.model, saved.deviceKey)).toBe(
      'remote'
    );
  });

  test('the cloud runner with no harness picked stays Remote, so it warns', () => {
    expect(editorHarness('remote', undefined, CLOUD_DEVICE_KEY)).toBe('remote');
  });
});

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

describe('RemoteAgentRunnerService questions', () => {
  const question = {
    id: 'q1',
    kind: 'question' as const,
    text: 'Who is Cosmo, and how old?',
    detail: null,
    answer: null,
    allowed: null,
    createdAt: 0,
    answeredAt: null,
  };

  test('a question opening is an update even with no new log text', async () => {
    const { runner } = createRunner([
      () => job({ log: '', logEnd: 0 }),
      () => job({ log: '', logEnd: 0, questions: [question] }),
      () => job({ log: '', logEnd: 0, questions: [{ ...question, answer: 'My son, 7', answeredAt: 1 }] }),
      () => job({ status: 'done', result: 'Bluey', log: '', logEnd: 0 }),
    ]);

    const open: string[][] = [];
    for await (const { job: update } of runner.watch('ws-1', 'job-1', new AbortController().signal)) {
      open.push(openQuestions(update).map(q => q.text));
    }

    // running, then waiting on Cosmo, then answered, then done.
    expect(open).toEqual([[], ['Who is Cosmo, and how old?'], [], []]);
  });

  test('answering posts to the question', async () => {
    const { runner, requests } = createRunner([() => job({})]);
    await runner.answer('ws-1', 'job-1', 'q1', { answer: 'My son, 7' });
    expect(requests).toEqual([
      { url: '/api/inventory/workspaces/ws-1/jobs/job-1/questions/q1/answer', method: 'POST' },
    ]);
  });
});

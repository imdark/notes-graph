/**
 * @vitest-environment happy-dom
 */
import { Framework } from '@notesgraph/infra';
import { describe, expect, test } from 'vitest';

import { LocalLLMService } from '../../ai-local';
import { WorkspaceService } from '../../workspace';
import { AgentRunLogsStore } from '../stores/agent-run-logs';
import { type AgentRun, AgentRunsStore } from '../stores/agent-runs';
import { CloudAgentRunnerService } from './cloud-runner';
import { AgentContextService } from './context';
import { AgentExecutorService } from './executor';
import { AgentFileToolsService } from './file-tools';
import { RemoteAgentRunnerService, type RemoteJob } from './remote-runner';
import { ResearchToolsService } from './research-tools';

const MINUTE = 60_000;

const row = (over: Partial<AgentRun>): AgentRun => ({
  id: 'r1',
  agentId: 'a1',
  agentName: 'Worker',
  targetKind: 'selection',
  docId: 'doc',
  status: 'running',
  startedAt: Date.now(),
  ...over,
});

const job = (over: Partial<RemoteJob>): RemoteJob => ({
  id: 'j1',
  deviceKey: 'box',
  status: 'running',
  result: null,
  error: null,
  steps: 3,
  tmuxSession: null,
  startedAt: null,
  finishedAt: null,
  ...over,
});

/**
 * An executor over fake runs and jobs, recording what it settles. `fakes`
 * swaps in the services a whole run needs (context, models, tools).
 */
const setup = (
  runs: AgentRun[],
  jobs: Record<string, RemoteJob>,
  fakes: {
    context?: object;
    fileTools?: object;
    cloudRunner?: object;
    researchTools?: object;
    remoteRunner?: object;
  } = {}
) => {
  const finished: { runId: string; outcome: any; endedAt?: number }[] = [];
  const titles: { runId: string; title: string }[] = [];
  const described: Record<string, unknown>[] = [];
  const runsStore = {
    runningRuns: () => runs.filter(run => run.status === 'running'),
    start: () => 'run-1',
    describe: (_runId: string, details: Record<string, unknown>) =>
      described.push(details),
    finish: (runId: string, outcome: any, endedAt?: number) =>
      finished.push({ runId, outcome, endedAt }),
    setTitle: (runId: string, title: string) => titles.push({ runId, title }),
  };
  const remoteRunner = {
    get: async (_workspaceId: string, jobId: string) => {
      const found = jobs[jobId];
      if (!found) throw new Error('unreachable');
      return found;
    },
    ...fakes.remoteRunner,
  };
  const framework = new Framework();
  framework
    .service(AgentContextService, (fakes.context ?? {}) as any)
    .store(AgentRunsStore, runsStore as any)
    .store(AgentRunLogsStore, { put: async () => {} } as any)
    .service(LocalLLMService, {} as any)
    .service(AgentFileToolsService, (fakes.fileTools ?? {}) as any)
    .service(RemoteAgentRunnerService, remoteRunner as any)
    .service(CloudAgentRunnerService, (fakes.cloudRunner ?? {}) as any)
    .service(ResearchToolsService, (fakes.researchTools ?? {}) as any)
    .service(WorkspaceService, { workspace: { id: 'ws' } } as any)
    .service(AgentExecutorService, [
      AgentContextService,
      AgentRunsStore,
      AgentRunLogsStore,
      LocalLLMService,
      AgentFileToolsService,
      RemoteAgentRunnerService,
      CloudAgentRunnerService,
      ResearchToolsService,
      WorkspaceService,
    ]);
  const executor = framework.provider().get(AgentExecutorService);
  return { executor, finished, titles, described };
};

describe('AgentExecutorService device runs', () => {
  test('a job held for the device’s session limit says so in its log', async () => {
    const runAfter = Date.UTC(2026, 9, 5, 22, 11) / 1000;
    const { executor } = setup([], {}, {
      context: { build: async () => ({ text: 'x', label: 'a block', title: 'x' }) },
      remoteRunner: {
        enqueue: async () => job({ id: 'j9', status: 'queued' }),
        agentTargets: async () => [],
        watch: async function* () {
          yield { job: job({ id: 'j9', status: 'queued', runAfter }), logDelta: '' };
          yield { job: job({ id: 'j9', status: 'done', result: 'ok' }), logDelta: '' };
        },
      },
    });
    (executor as any).runsStore.attachRemote = () => {};
    const logs: string[] = [];
    for await (const event of executor.run(
      { id: 'a1', name: 'W', harness: 'remote', deviceKey: 'laptop', model: 'workflow', tools: [], instructions: 'go', maxSteps: 4 } as any,
      { kind: 'block', docId: 'doc', blockId: 'b1' },
      new AbortController().signal
    )) {
      if (event.type === 'log') logs.push(event.text);
    }
    expect(logs.join('')).toMatch(/⏸ Session limit reached on laptop; waiting to run again at/);
  });
});

describe('AgentExecutorService research runs', () => {
  test('the server model calls OmniSeek through the research tools, then answers', async () => {
    // The model asks for one search, then answers from its result.
    const replies = [
      '```tool\n{"tool": "omniseek_search", "args": {"query": "graph RAG"}}\n```',
      'GraphRAG beats plain RAG on global questions [https://arxiv.org/abs/2404.16130].',
    ];
    const prompts: string[] = [];
    const calls: unknown[] = [];
    const { executor, finished, described } = setup([], {}, {
      context: { build: async () => ({ text: 'Survey graph RAG', label: 'a block', title: 'Survey graph RAG' }) },
      fileTools: { available: false },
      cloudRunner: {
        open: async () =>
          async function* (messages: { content: string }[]) {
            prompts.push(messages[0].content);
            yield replies.shift() ?? '';
          },
      },
      researchTools: {
        specs: async () => [
          { name: 'omniseek_search', desc: 'Search widely', args: { query: 'what to look for' }, mutates: false },
        ],
        call: async (workspaceId: string, name: string, args: unknown) => {
          calls.push({ workspaceId, name, args });
          return '1. From Local to Global: A Graph RAG Approach — arxiv.org/abs/2404.16130';
        },
      },
    });

    const events = [];
    for await (const event of executor.run(
      { id: 'a1', name: 'Researcher', harness: 'research', tools: [], instructions: '', maxSteps: 4 } as any,
      { kind: 'block', docId: 'doc', blockId: 'b1' },
      new AbortController().signal
    )) {
      events.push(event);
    }

    expect(calls).toEqual([
      { workspaceId: 'ws', name: 'omniseek_search', args: { query: 'graph RAG' } },
    ]);
    // Told about the research tools and how to cite, and not about a folder.
    expect(prompts[0]).toContain('omniseek_search');
    expect(prompts[0]).toContain('source URL');
    expect(prompts[0]).not.toContain('bound to this workspace');
    expect(described[0]).toMatchObject({ harness: 'research', model: 'server default + OmniSeek' });
    expect(finished[0].outcome).toMatchObject({
      status: 'done',
      output: expect.stringContaining('arxiv.org/abs/2404.16130'),
    });
  });

  test('a tool the run was not given is refused, not dispatched', async () => {
    const replies = [
      '```tool\n{"tool": "omniseek_curator_act", "args": {}}\n```',
      'Could not do that.',
    ];
    const logs: string[] = [];
    const { executor } = setup([], {}, {
      context: { build: async () => ({ text: 'x', label: 'a block', title: 'x' }) },
      fileTools: { available: false },
      cloudRunner: {
        open: async () =>
          async function* () {
            yield replies.shift() ?? '';
          },
      },
      researchTools: {
        specs: async () => [{ name: 'omniseek_search', desc: 's', args: {}, mutates: false }],
        call: async () => {
          throw new Error('must not be called');
        },
      },
    });
    for await (const event of executor.run(
      { id: 'a1', name: 'R', harness: 'research', tools: [], instructions: '', maxSteps: 4 } as any,
      { kind: 'block', docId: 'doc', blockId: 'b1' },
      new AbortController().signal
    )) {
      if (event.type === 'log') logs.push(event.text);
    }
    expect(logs.join('')).toContain('There is no tool called omniseek_curator_act');
  });
});

describe('AgentExecutorService.reconcileRuns', () => {
  test('a device run whose job finished takes the job’s end', async () => {
    const startedAt = Date.now() - 5 * MINUTE;
    const { executor, finished } = setup(
      [row({ startedAt, remoteJobId: 'j1' })],
      {
        j1: job({
          status: 'done',
          result: 'All done',
          finishedAt: (startedAt + 2 * MINUTE) / 1000,
        }),
      }
    );
    await executor.reconcileRuns();
    expect(finished).toEqual([
      {
        runId: 'r1',
        outcome: { status: 'done', steps: 3, output: 'All done' },
        endedAt: startedAt + 2 * MINUTE,
      },
    ]);
  });

  test('a device run takes the title its agent gave it', async () => {
    const { executor, titles } = setup([row({ remoteJobId: 'j1' })], {
      j1: job({ status: 'done', title: 'Pick a show for Cosmo' }),
    });
    await executor.reconcileRuns();
    expect(titles).toEqual([{ runId: 'r1', title: 'Pick a show for Cosmo' }]);
  });

  test('a device run still going, or unreachable, is left alone', async () => {
    const { executor, finished } = setup(
      [
        row({ id: 'r1', remoteJobId: 'j1' }),
        row({ id: 'r2', remoteJobId: 'gone' }),
      ],
      { j1: job({ status: 'running' }) }
    );
    await executor.reconcileRuns();
    expect(finished).toEqual([]);
  });

  test('a failed device job settles as an error', async () => {
    const { executor, finished } = setup(
      [row({ remoteJobId: 'j1' })],
      { j1: job({ status: 'error', error: 'boom', finishedAt: 1 }) }
    );
    await executor.reconcileRuns();
    expect(finished[0].outcome).toEqual({
      status: 'error',
      steps: 3,
      error: 'boom',
    });
  });

  test('an in-tab run past every wall clock is recorded as interrupted', async () => {
    const { executor, finished } = setup(
      [
        row({ id: 'old', startedAt: Date.now() - 60 * MINUTE }),
        row({ id: 'recent', startedAt: Date.now() - MINUTE }),
      ],
      {}
    );
    await executor.reconcileRuns();
    expect(finished.map(f => f.runId)).toEqual(['old']);
    expect(finished[0].outcome.status).toBe('error');
    expect(finished[0].outcome.error).toMatch(/Interrupted/);
  });
});

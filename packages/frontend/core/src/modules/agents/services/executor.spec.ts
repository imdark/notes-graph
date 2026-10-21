/**
 * @vitest-environment happy-dom
 */
import { Framework } from '@notesgraph/infra';
import { describe, expect, test } from 'vitest';

import { LocalLLMService } from '../../ai-local';
import { WorkspaceService } from '../../workspace';
import { AgentRunLogsStore } from '../stores/agent-run-logs';
import { type AgentRun, AgentRunsStore } from '../stores/agent-runs';
import { AgentRulesService } from './agent-rules';
import { CloudAgentRunnerService } from './cloud-runner';
import { AgentContextService } from './context';
import { AgentExecutorService, countFound, foundLine } from './executor';
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
  agentId: 'a1',
  agentName: 'Claude',
  model: null,
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
    agentRules?: object;
    localLLM?: object;
  } = {}
) => {
  const finished: { runId: string; outcome: any; endedAt?: number }[] = [];
  const titles: { runId: string; title: string }[] = [];
  const described: Record<string, unknown>[] = [];
  const usages: { runId: string; usage: unknown }[] = [];
  const runsStore = {
    setUsage: (runId: string, usage: unknown) => usages.push({ runId, usage }),
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
    .service(LocalLLMService, (fakes.localLLM ?? {}) as any)
    .service(AgentFileToolsService, (fakes.fileTools ?? {}) as any)
    .service(RemoteAgentRunnerService, remoteRunner as any)
    .service(CloudAgentRunnerService, (fakes.cloudRunner ?? {}) as any)
    .service(ResearchToolsService, (fakes.researchTools ?? {}) as any)
    .service(WorkspaceService, { workspace: { id: 'ws' } } as any)
    .service(AgentRulesService, (fakes.agentRules ?? {}) as any)
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
      AgentRulesService,
    ]);
  const executor = framework.provider().get(AgentExecutorService);
  return { executor, finished, titles, described, usages };
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

  test('a device run is queued with its cost cap and permission level, and records its cost', async () => {
    const enqueued: any[] = [];
    const { executor, usages } = setup([], {}, {
      context: { build: async () => ({ text: 'x', label: 'a block', title: 'x' }) },
      remoteRunner: {
        enqueue: async (_ws: string, input: any) => {
          enqueued.push(input);
          return job({ id: 'j9', status: 'queued' });
        },
        agentTargets: async () => [],
        watch: async function* () {
          yield { job: job({ id: 'j9', status: 'running' }), logDelta: '' };
          yield {
            job: job({ id: 'j9', status: 'done', result: 'ok', costUsd: 0.42, tokens: 1234 }),
            logDelta: '',
          };
        },
      },
    });
    (executor as any).runsStore.attachRemote = () => {};
    for await (const _ of executor.run(
      { id: 'a1', name: 'W', harness: 'remote', deviceKey: 'laptop', model: 'claude-code', tools: [], instructions: 'go', maxSteps: 4, maxCostUsd: 2.5, access: 'manage' } as any,
      { kind: 'block', docId: 'doc', blockId: 'b1' },
      new AbortController().signal
    )) {
      // drain
    }
    expect(enqueued[0]).toMatchObject({ maxCostUsd: 2.5, access: 'manage' });
    expect(usages.at(-1)).toEqual({
      runId: 'run-1',
      usage: { costUsd: 0.42, tokens: 1234 },
    });
  });

  test('an agent with no cap or level leaves both off the job', async () => {
    const enqueued: any[] = [];
    const { executor } = setup([], {}, {
      context: { build: async () => ({ text: 'x', label: 'a block', title: 'x' }) },
      remoteRunner: {
        enqueue: async (_ws: string, input: any) => {
          enqueued.push(input);
          return job({ id: 'j9', status: 'queued' });
        },
        agentTargets: async () => [],
        watch: async function* () {
          yield { job: job({ id: 'j9', status: 'done', result: 'ok' }), logDelta: '' };
        },
      },
    });
    (executor as any).runsStore.attachRemote = () => {};
    for await (const _ of executor.run(
      { id: 'a1', name: 'W', harness: 'remote', deviceKey: 'laptop', model: 'claude-code', tools: [], instructions: 'go', maxSteps: 4 } as any,
      { kind: 'block', docId: 'doc', blockId: 'b1' },
      new AbortController().signal
    )) {
      // drain
    }
    expect(enqueued[0].maxCostUsd).toBeUndefined();
    expect(enqueued[0].access).toBeUndefined();
  });

  test('a refused enqueue fails the run with the server’s reason', async () => {
    const { executor, finished } = setup([], {}, {
      context: { build: async () => ({ text: 'x', label: 'a block', title: 'x' }) },
      remoteRunner: {
        enqueue: async () => {
          throw new Error('This workspace has used its monthly agent budget.');
        },
      },
    });
    const errors: string[] = [];
    for await (const event of executor.run(
      { id: 'a1', name: 'W', harness: 'remote', deviceKey: 'laptop', model: 'claude-code', tools: [], instructions: 'go', maxSteps: 4 } as any,
      { kind: 'block', docId: 'doc', blockId: 'b1' },
      new AbortController().signal
    )) {
      if (event.type === 'error') errors.push(event.message);
    }
    expect(errors).toEqual(['This workspace has used its monthly agent budget.']);
    expect(finished[0].outcome).toMatchObject({
      status: 'error',
      error: 'This workspace has used its monthly agent budget.',
    });
  });
});

describe('AgentExecutorService.chatFor', () => {
  test('a device agent is asked on its device, told only to answer', async () => {
    const enqueued: any[] = [];
    const { executor } = setup([], {}, {
      remoteRunner: {
        enqueue: async (_ws: string, input: any) => {
          enqueued.push(input);
          return job({ id: 'q1', status: 'queued' });
        },
        watch: async function* () {
          yield { job: job({ id: 'q1', status: 'running' }), logDelta: '' };
          yield { job: job({ id: 'q1', status: 'done', result: 'It edited two lines.' }), logDelta: '' };
        },
      },
    });
    const chat = await executor.chatFor(
      { id: 'a1', name: 'Claude', harness: 'remote', deviceKey: 'laptop', model: 'claude-code', tools: ['Bash'], instructions: 'do work', maxSteps: 40 } as any
    );
    let reply = '';
    for await (const delta of chat(
      [
        { role: 'user', content: 'The run: fix the toolbar.' },
        { role: 'user', content: 'What did it change?' },
      ],
      new AbortController().signal
    )) {
      reply += delta;
    }
    expect(reply).toBe('It edited two lines.');
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ deviceKey: 'laptop', agentId: 'a1', model: 'claude-code', tools: [] });
    expect(enqueued[0].instructions).toMatch(/Only answer/);
    expect(enqueued[0].context).toContain('What did it change?');
  });

  test('a device question that fails says why', async () => {
    const { executor } = setup([], {}, {
      remoteRunner: {
        enqueue: async () => job({ id: 'q2', status: 'queued' }),
        watch: async function* () {
          yield { job: job({ id: 'q2', status: 'error', error: 'device offline' }), logDelta: '' };
        },
      },
    });
    const chat = await executor.chatFor(
      { id: 'a1', name: 'Claude', harness: 'remote', deviceKey: 'laptop', tools: [], instructions: '', maxSteps: 4 } as any
    );
    await expect(async () => {
      for await (const _ of chat([{ role: 'user', content: 'hi' }], new AbortController().signal)) {
        // drain
      }
    }).rejects.toThrow('device offline');
  });

  test('a fork of a waiting run is asked on its device, not the server', async () => {
    const enqueued: any[] = [];
    const opened: string[] = [];
    const { executor } = setup([], {}, {
      cloudRunner: {
        available: false,
        open: async (workspaceId: string) => {
          opened.push(workspaceId);
          throw new Error('This server has no AI model set up');
        },
      },
      remoteRunner: {
        enqueue: async (_ws: string, input: any) => {
          enqueued.push(input);
          return job({ id: 'f1', status: 'queued' });
        },
        watch: async function* () {
          yield { job: job({ id: 'f1', status: 'done', result: 'Pick main.' }), logDelta: '' };
        },
      },
    });
    const chat = await executor.forkOf(
      job({ id: 'r1', status: 'running', deviceKey: 'cloud', agentId: 'a1', agentName: 'Claude', model: 'claude-code', maxCostUsd: 2 })
    );
    let reply = '';
    for await (const delta of chat(
      [
        { role: 'system', content: 'Talk it through.' },
        { role: 'user', content: 'Which branch should it use?' },
      ],
      new AbortController().signal
    )) {
      reply += delta;
    }
    expect(reply).toBe('Pick main.');
    expect(opened).toEqual([]);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ deviceKey: 'cloud', agentId: 'a1', model: 'claude-code', tools: [], maxCostUsd: 2 });
    expect(enqueued[0].instructions).toMatch(/still going/);
    expect(enqueued[0].context).toContain('Which branch should it use?');
  });

  test('an agent with no device can\'t be asked', async () => {
    const { executor } = setup([], {}, {});
    await expect(
      executor.chatFor({ id: 'a1', name: 'Claude', harness: 'remote', tools: [], instructions: '', maxSteps: 4 } as any)
    ).rejects.toThrow(/no device selected/);
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
        available: true,
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

  test('a server with no model still runs research, on the device’s model', async () => {
    const replies = [
      '```tool\n{"tool": "omniseek_search", "args": {"query": "graph RAG"}}\n```',
      'GraphRAG [https://arxiv.org/abs/2404.16130].',
    ];
    const calls: unknown[] = [];
    const logs: string[] = [];
    const { executor, finished, described } = setup([], {}, {
      context: { build: async () => ({ text: 'Survey graph RAG', label: 'a block', title: 'x' }) },
      fileTools: { available: false },
      cloudRunner: {
        available: false,
        open: async () => {
          throw new Error('no copilot');
        },
      },
      localLLM: {
        chatStream: async function* () {
          yield replies.shift() ?? '';
        },
      },
      researchTools: {
        specs: async () => [
          { name: 'omniseek_search', desc: 'Search widely', args: { query: 'what to look for' }, mutates: false },
        ],
        call: async (_ws: string, name: string) => {
          calls.push(name);
          return '1. arxiv.org/abs/2404.16130';
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
    expect(calls).toEqual(['omniseek_search']);
    expect(described[0]).toMatchObject({ harness: 'research', model: expect.stringMatching(/-MLC \+ OmniSeek$/) });
    expect(logs.join('')).toContain('no AI model set up');
    expect(finished[0].outcome).toMatchObject({ status: 'done' });
  });

  test('a server with no model but its own runner hands research to that runner', async () => {
    const enqueued: any[] = [];
    const logs: string[] = [];
    const { executor, finished } = setup([], {}, {
      context: { build: async () => ({ text: 'Survey graph RAG', label: 'a block', title: 'x' }) },
      cloudRunner: { available: false },
      remoteRunner: {
        agentTargets: async () => [{ key: 'cloud', name: 'Cloud (server)', state: 'online', kind: 'server' }],
        enqueue: async (_ws: string, input: any) => {
          enqueued.push(input);
          return job({ id: 'j1', status: 'queued' });
        },
        watch: async function* () {
          yield { job: job({ id: 'j1', status: 'done', result: 'GraphRAG' }), logDelta: '' };
        },
      },
    });
    (executor as any).runsStore.attachRemote = () => {};
    for await (const event of executor.run(
      { id: 'a1', name: 'R', harness: 'research', tools: ['omniseek_search'], instructions: '', maxSteps: 4 } as any,
      { kind: 'block', docId: 'doc', blockId: 'b1' },
      new AbortController().signal
    )) {
      if (event.type === 'log') logs.push(event.text);
    }
    expect(enqueued[0]).toMatchObject({ deviceKey: 'cloud', model: 'research', tools: [] });
    expect(logs.join('')).toContain("runs on the server's runner");
    expect(finished[0].outcome).toMatchObject({ status: 'done' });
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
        available: true,
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

  test('independent searches in one reply run together, in order; a repeat is not re-run', async () => {
    const replies = [
      [
        '```tool\n{"tool": "omniseek_search", "args": {"query": "graph RAG"}}\n```',
        '```tool\n{"tool": "omniseek_search", "args": {"query": "GraphRAG eval"}}\n```',
      ].join('\n'),
      '```tool\n{"tool": "omniseek_search", "args": {"query": "  Graph   RAG "}}\n```',
      'Done.',
    ];
    const userTurns: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const calls: string[] = [];
    const logs: string[] = [];
    const { executor } = setup([], {}, {
      context: { build: async () => ({ text: 'x', label: 'a block', title: 'x' }) },
      fileTools: { available: false },
      cloudRunner: {
        available: true,
        open: async () =>
          async function* (messages: { role: string; content: string }[]) {
            userTurns.push(messages.at(-1)!.content);
            yield replies.shift() ?? '';
          },
      },
      researchTools: {
        specs: async () => [{ name: 'omniseek_search', desc: 's', args: { query: 'q' }, mutates: false }],
        call: async (_ws: string, _name: string, args: { query: string }) => {
          calls.push(args.query);
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          // The first call finishes last: results still come back in order.
          await new Promise(resolve => setTimeout(resolve, args.query === 'graph RAG' ? 20 : 1));
          inFlight -= 1;
          return `results for ${args.query}`;
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
    expect(calls).toEqual(['graph RAG', 'GraphRAG eval']);
    expect(maxInFlight).toBe(2);
    expect(userTurns[1]).toBe(
      'Result of omniseek_search:\nresults for graph RAG\n\nResult of omniseek_search:\nresults for GraphRAG eval'
    );
    expect(userTurns[2]).toContain('Already searched for "Graph   RAG" — see the earlier result.');
    expect(logs.join('')).toContain('Already searched for');
  });
});

describe('countFound', () => {
  test('counts hits and distinct docs in each NotesGraph result shape', () => {
    expect(
      countFound(
        JSON.stringify({
          blocks: [
            { docId: 'd1', blockId: 'a' },
            { docId: 'd1', blockId: 'b' },
            { docId: 'd2', blockId: 'c' },
          ],
          nextCursor: null,
        })
      )
    ).toEqual({ notes: 3, docs: 2 });
    expect(countFound('{"docId":"d1","title":"A"}\n{"docId":"d2","title":"B"}')).toEqual({ notes: 2, docs: 2 });
    expect(countFound('No matching documents found.')).toEqual({ notes: 0, docs: 0 });
    expect(foundLine({ notes: 3, docs: 2 })).toBe('Found 3 notes across 2 docs');
    expect(foundLine({ notes: 1, docs: 0 })).toBe('Found 1 note');
  });
});

describe('AgentExecutorService agent rules', () => {
  const runCloud = async (agentRules: object, withTools: boolean) => {
    const prompts: string[] = [];
    const { executor, finished } = setup([], {}, {
      context: { build: async () => ({ text: 'x', label: 'a block', title: 'x' }) },
      fileTools: { available: false },
      cloudRunner: {
        available: true,
        open: async () =>
          async function* (messages: { content: string }[]) {
            prompts.push(messages[0].content);
            yield 'Done.';
          },
      },
      researchTools: {
        specs: async () =>
          withTools ? [{ name: 'omniseek_search', desc: 's', args: {}, mutates: false }] : [],
      },
      agentRules,
    });
    for await (const _ of executor.run(
      { id: 'a1', name: 'R', harness: withTools ? 'research' : 'cloud', tools: [], instructions: 'Do it', maxSteps: 2 } as any,
      { kind: 'block', docId: 'doc', blockId: 'b1' },
      new AbortController().signal
    )) {
      // drain
    }
    return { prompt: prompts[0], finished };
  };

  test('an in-tab run is told the rules note, with tools or without', async () => {
    for (const withTools of [true, false]) {
      const { prompt } = await runCloud(
        { read: async () => 'Research notes go under "Research".' },
        withTools
      );
      expect(prompt).toContain('Do it');
      expect(prompt).toContain(
        '<agent-rules>\nResearch notes go under "Research".\n</agent-rules>'
      );
    }
  });

  test('no note, or one that fails to read, and the run goes without', async () => {
    for (const agentRules of [
      { read: async () => null },
      {
        read: async () => {
          throw new Error('boom');
        },
      },
    ]) {
      const { prompt, finished } = await runCloud(agentRules, false);
      expect(prompt).not.toContain('agent-rules');
      expect(finished[0].outcome).toMatchObject({ status: 'done' });
    }
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

  test('a settled device run keeps what its job cost', async () => {
    const { executor, finished } = setup([row({ remoteJobId: 'j1' })], {
      j1: job({ status: 'error', error: 'Over the cost cap', costUsd: 2.51, tokens: 90000, finishedAt: 1 }),
    });
    await executor.reconcileRuns();
    expect(finished[0].outcome).toEqual({
      status: 'error',
      steps: 3,
      error: 'Over the cost cap',
      usage: { costUsd: 2.51, tokens: 90000 },
    });
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

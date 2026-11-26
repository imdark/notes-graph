/**
 * @vitest-environment happy-dom
 */
import { Framework, LiveData } from '@notesgraph/infra';
import { describe, expect, test, vi } from 'vitest';

import { DocsService } from '../../doc';
import type { AgentRun } from '../stores/agent-runs';
import type { Agent } from '../stores/agents';
import { AGENT_TEMPLATES } from './agent-templates';
import { AgentsService } from './agents';
import { CLAUDE_CODE_MODEL, CLOUD_DEVICE_KEY } from './remote-runner';
import { AgentRunSessionService } from './run-session';
import {
  findVerifyAgent,
  VERIFICATIONS_DOC_TITLE,
  VERIFY_AGENT_NAME,
  VERIFY_INSTRUCTIONS,
  VERIFY_TEMPLATE,
  verifyBrief,
  verifyKey,
  VerifyService,
  type VerifyTarget,
} from './verify';

const run = (patch: Partial<AgentRun> = {}): AgentRun => ({
  id: 'run-1',
  agentId: 'a0',
  agentName: 'cloud',
  targetKind: 'block',
  docId: 'd1',
  title: 'Add  "Generate title"\nnote action',
  status: 'error',
  startedAt: Date.UTC(2026, 10, 26, 21, 14),
  error: 'Network error: timeout after 15000ms',
  ...patch,
});

const pull: VerifyTarget = {
  kind: 'pull',
  repo: 'imdark/notes-graph',
  number: 441,
  url: 'https://github.com/imdark/notes-graph/pull/441',
  title: 'Discover appends feed updates',
  branch: 'personal-308-discovery',
  merged: true,
  base: 'stage',
  tasks: [
    {
      docId: 'j',
      blockId: 'b',
      title: 'PERSONAL-308 append updates',
      status: 'done',
    },
  ],
};

describe('what a verification is asked to check', () => {
  test('a run: its record, its job or how to find it, its error and answer', () => {
    const brief = verifyBrief({
      kind: 'run',
      run: run({ summary: 'Built it; wf done failed.' }),
    });
    expect(brief.title).toBe('Verify run: Add "Generate title" note action');
    expect(brief.details[0]).toContain('recorded as error');
    expect(brief.details[1]).toMatch(/No job id was recorded; find the job/);
    expect(brief.details).toContain(
      'Recorded error: Network error: timeout after 15000ms'
    );
    expect(brief.details).toContain('Its answer: Built it; wf done failed.');

    const withJob = verifyBrief({
      kind: 'run',
      run: run({ remoteJobId: 'job-9', deviceKey: 'cloud', error: undefined }),
    });
    expect(withJob.details[1]).toBe('Job job-9 on cloud.');
    expect(withJob.details.some(d => d.startsWith('Recorded error'))).toBe(
      false
    );
  });

  test('a pull request: where it is, whether merged, and its tasks', () => {
    const brief = verifyBrief(pull);
    expect(brief.title).toBe(
      'Verify pull request #441: Discover appends feed updates'
    );
    expect(brief.details).toEqual([
      'https://github.com/imdark/notes-graph/pull/441 in imdark/notes-graph, branch personal-308-discovery, merged into stage.',
      'Task: PERSONAL-308 append updates (done)',
    ]);
  });

  test('a branch, which may have no pull request', () => {
    const brief = verifyBrief({
      kind: 'branch',
      repo: 'imdark/notes-graph',
      branch: 'cloud-147-generate-title',
      base: 'stage',
    });
    expect(brief.title).toBe('Verify branch cloud-147-generate-title');
    expect(brief.details[0]).toMatch(/may have no pull request yet/);
  });

  test('the same target is the same verification', () => {
    expect(verifyKey({ kind: 'run', run: run() })).toBe('run:run-1');
    expect(verifyKey(pull)).toBe('pull:imdark/notes-graph#441');
  });

  test('the agent is Claude Code on the server runner and changes nothing', () => {
    expect(VERIFY_TEMPLATE.draft).toMatchObject({
      model: CLAUDE_CODE_MODEL,
      deviceKey: CLOUD_DEVICE_KEY,
    });
    expect(VERIFY_INSTRUCTIONS).toMatch(/Change nothing: do not push, merge/);
    expect(VERIFY_INSTRUCTIONS).toContain('list_agent_runs');
    expect(VERIFY_INSTRUCTIONS).toContain('deploy_info');
    expect(AGENT_TEMPLATES).toContain(VERIFY_TEMPLATE);
    const renamed = {
      name: 'Mine',
      instructions: VERIFY_INSTRUCTIONS,
    } as Agent;
    expect(findVerifyAgent([renamed])).toBe(renamed);
  });
});

describe('starting a verification', () => {
  const setup = (agents: Agent[]) => {
    const blocks: { flavour: string; parent: string }[] = [];
    const store = {
      getBlocksByFlavour: () => [{ id: 'note' }],
      addBlock: (flavour: string, _props: unknown, parent: string) => {
        blocks.push({ flavour, parent });
        return `b${blocks.length}`;
      },
    };
    const createDoc = vi.fn(() => ({ id: 'verifications' }));
    const docsService = {
      list: { docs$: new LiveData([]) },
      createDoc,
      open: () => ({
        doc: { waitForSyncReady: async () => {}, blockSuiteDoc: store },
        release: () => {},
      }),
    };
    const agentsService = {
      agents$: new LiveData(agents),
      create: vi.fn(() => ({ id: 'a-new', name: VERIFY_AGENT_NAME }) as Agent),
    };
    const sessions$ = new LiveData<any[]>([]);
    const start = vi.fn(
      (agent: Agent, target: any) =>
        new Promise<void>(() => {
          sessions$.setValue([{ agentId: agent.id, target, runId: 'run-v' }]);
        })
    );
    const framework = new Framework();
    framework
      .service(DocsService, docsService as any)
      .service(AgentsService, agentsService as any)
      .service(AgentRunSessionService, { start, sessions$ } as any)
      .service(VerifyService, [
        DocsService,
        AgentsService,
        AgentRunSessionService,
      ]);
    return {
      service: framework.provider().get(VerifyService),
      blocks,
      createDoc,
      start,
      agentsService,
    };
  };

  test('writes the to-do with its details, starts the agent and remembers it', async () => {
    const { service, blocks, createDoc, start, agentsService } = setup([]);
    const started = await service.verify(pull);

    expect(createDoc).toHaveBeenCalledWith({ title: VERIFICATIONS_DOC_TITLE });
    expect(blocks.map(b => [b.flavour, b.parent])).toEqual([
      ['notesgraph:list', 'note'],
      ['notesgraph:paragraph', 'b1'],
      ['notesgraph:paragraph', 'b1'],
    ]);
    expect(agentsService.create).toHaveBeenCalledWith(
      'personal',
      VERIFY_TEMPLATE.draft
    );
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a-new' }),
      { kind: 'block', docId: 'verifications', blockId: 'b1' }
    );
    expect(started).toEqual({
      docId: 'verifications',
      blockId: 'b1',
      runId: 'run-v',
    });
    expect(service.watch(verifyKey(pull)).value).toEqual(started);
  });
});

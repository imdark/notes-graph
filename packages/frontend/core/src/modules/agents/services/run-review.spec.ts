/**
 * @vitest-environment happy-dom
 */
import { Framework, LiveData } from '@notesgraph/infra';
import { describe, expect, test, vi } from 'vitest';

import { DocsService } from '../../doc';
import type { Agent } from '../stores/agents';
import { AGENT_TEMPLATES } from './agent-templates';
import { AgentsService } from './agents';
import { CLAUDE_CODE_MODEL, CLOUD_DEVICE_KEY } from './remote-runner';
import {
  findRunReviewAgent,
  RUN_REVIEW_AGENT_NAME,
  RUN_REVIEW_INSTRUCTIONS,
  RUN_REVIEW_TEMPLATE,
  RUN_REVIEWS_DOC_TITLE,
  RunReviewService,
  runReviewTitle,
} from './run-review';
import { AgentRunSessionService } from './run-session';

const reviewAgent = {
  id: 'a1',
  name: RUN_REVIEW_AGENT_NAME,
  deviceKey: 'cloud',
} as Agent;

/** A Run reviews note that records the blocks written to it. */
const setup = (opts: { existingDocId?: string; agents?: Agent[] } = {}) => {
  const blocks: { flavour: string; props: any; parent: string }[] = [];
  const store = {
    getBlocksByFlavour: () => [{ id: 'note' }],
    addBlock: (flavour: string, props: any, parent: string) => {
      blocks.push({ flavour, props, parent });
      return `b${blocks.length}`;
    },
  };
  const createDoc = vi.fn(() => ({ id: 'new-doc' }));
  const docsService = {
    list: {
      docs$: new LiveData(
        opts.existingDocId
          ? [
              {
                id: opts.existingDocId,
                trash$: new LiveData(false),
                title$: new LiveData(RUN_REVIEWS_DOC_TITLE),
              },
            ]
          : []
      ),
    },
    createDoc,
    open: () => ({
      doc: { waitForSyncReady: async () => {}, blockSuiteDoc: store },
      release: () => {},
    }),
  };
  const created = { id: 'a-new', name: RUN_REVIEW_AGENT_NAME } as Agent;
  const agentsService = {
    agents$: new LiveData(opts.agents ?? [reviewAgent]),
    create: vi.fn(() => created),
  };
  // A run that gets its record at once and keeps going: review() must not
  // wait for it to end.
  const sessions$ = new LiveData<any[]>([]);
  const start = vi.fn(
    (agent: Agent, target: any) =>
      new Promise<void>(() => {
        sessions$.setValue([{ agentId: agent.id, target, runId: 'run-1' }]);
      })
  );
  const framework = new Framework();
  framework
    .service(DocsService, docsService as any)
    .service(AgentsService, agentsService as any)
    .service(AgentRunSessionService, { start, sessions$ } as any)
    .service(RunReviewService, [
      DocsService,
      AgentsService,
      AgentRunSessionService,
    ]);
  const service = framework.provider().get(RunReviewService);
  return { service, blocks, createDoc, start, agentsService };
};

describe('run reviews', () => {
  test('names the window and the day in the to-do', () => {
    expect(runReviewTitle(3, new Date('2026-11-26T20:00:00Z'))).toBe(
      'Review agent runs from the last 3 days (2026-11-26)'
    );
  });

  test('the agent is Claude Code on the server runner, and only reviews', () => {
    expect(RUN_REVIEW_TEMPLATE.draft).toMatchObject({
      model: CLAUDE_CODE_MODEL,
      deviceKey: CLOUD_DEVICE_KEY,
    });
    expect(RUN_REVIEW_INSTRUCTIONS).toContain('list_agent_runs');
    expect(RUN_REVIEW_INSTRUCTIONS).toContain('deploy_info');
    expect(RUN_REVIEW_INSTRUCTIONS).toMatch(/Do not merge, close, deploy/);
    expect(AGENT_TEMPLATES).toContain(RUN_REVIEW_TEMPLATE);
  });

  test('finds the agent by name, or by its instructions once renamed', () => {
    const renamed = {
      name: 'Mine',
      instructions: RUN_REVIEW_INSTRUCTIONS,
    } as Agent;
    expect(findRunReviewAgent([reviewAgent])).toBe(reviewAgent);
    expect(findRunReviewAgent([renamed])).toBe(renamed);
    expect(findRunReviewAgent([])).toBeUndefined();
  });

  test('writes the review to-do in a new Run reviews note and starts the agent on it', async () => {
    const { service, blocks, createDoc, start } = setup();
    const at = await service.review(3);

    expect(createDoc).toHaveBeenCalledWith({ title: RUN_REVIEWS_DOC_TITLE });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      flavour: 'notesgraph:list',
      parent: 'note',
      props: { type: 'todo', checked: false },
    });
    expect(at).toEqual({ docId: 'new-doc', blockId: 'b1', runId: 'run-1' });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), {
      kind: 'block',
      docId: 'new-doc',
      blockId: 'b1',
    });
  });

  test('reuses the note, and makes the agent the first time', async () => {
    const { service, createDoc, start, agentsService } = setup({
      existingDocId: 'reviews',
      agents: [],
    });
    await service.review();

    expect(createDoc).not.toHaveBeenCalled();
    expect(agentsService.create).toHaveBeenCalledWith(
      'personal',
      RUN_REVIEW_TEMPLATE.draft
    );
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a-new' }),
      expect.objectContaining({ docId: 'reviews' })
    );
  });
});

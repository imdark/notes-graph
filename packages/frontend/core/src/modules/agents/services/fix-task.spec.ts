/**
 * @vitest-environment happy-dom
 */
import { Framework, LiveData } from '@notesgraph/infra';
import { describe, expect, test, vi } from 'vitest';

import { DocsService } from '../../doc';
import type { Agent } from '../stores/agents';
import { AgentsService } from './agents';
import {
  findFixAgent,
  FIX_AGENT_INSTRUCTIONS,
  FIX_AGENT_NAME,
  FIX_UPS_DOC_TITLE,
  fixKey,
  FixTaskService,
  fixTaskTitle,
} from './fix-task';
import { AgentRunSessionService } from './run-session';

const fixAgent = {
  id: 'a1',
  name: FIX_AGENT_NAME,
  deviceKey: 'cloud',
} as Agent;

/** A Fix-ups note that records the blocks written to it. */
const setup = (existingDocId?: string) => {
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
        existingDocId
          ? [
              {
                id: existingDocId,
                trash$: new LiveData(false),
                title$: new LiveData(FIX_UPS_DOC_TITLE),
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
  const agentsService = {
    agents$: new LiveData([fixAgent]),
    create: vi.fn(),
  };
  // A run that gets its record at once and then keeps going: fix() must
  // not wait for it to end.
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
    .service(FixTaskService, [
      DocsService,
      AgentsService,
      AgentRunSessionService,
    ]);
  const service = framework.provider().get(FixTaskService);
  return { service, blocks, createDoc, start };
};

describe('fix tasks', () => {
  test('titles a to-do from the failure, on one line', () => {
    expect(fixTaskTitle({ title: 'Disk  94%\non box-1', details: [] })).toBe(
      'Fix: Disk 94% on box-1'
    );
  });

  test('finds the agent by name, or by its instructions once renamed', () => {
    const renamed = {
      name: 'Mine',
      instructions: FIX_AGENT_INSTRUCTIONS,
    } as Agent;
    expect(findFixAgent([fixAgent])).toBe(fixAgent);
    expect(findFixAgent([renamed])).toBe(renamed);
    expect(findFixAgent([])).toBeUndefined();
  });

  test('writes the failure as a to-do with its details and runs on its machine', async () => {
    const { service, blocks, createDoc, start } = setup();
    const at = await service.fix({
      title: 'Disk at 94% on box-1',
      details: ['Check: disk, status fail.', 'Machine: box-1'],
      sourceDocId: 'monitor-note',
      deviceKey: 'box-1',
    });

    expect(createDoc).toHaveBeenCalledWith({ title: FIX_UPS_DOC_TITLE });
    expect(blocks[0]).toMatchObject({
      flavour: 'notesgraph:list',
      parent: 'note',
      props: { type: 'todo', checked: false },
    });
    // Two detail lines, then the link to where it came from, all under the
    // to-do (the text itself is only readable once in a real Y doc).
    expect(blocks.slice(1).map(b => [b.flavour, b.parent])).toEqual([
      ['notesgraph:paragraph', 'b1'],
      ['notesgraph:paragraph', 'b1'],
      ['notesgraph:paragraph', 'b1'],
    ]);
    expect(at).toEqual({ docId: 'new-doc', blockId: 'b1', runId: 'run-1' });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1', deviceKey: 'box-1' }),
      { kind: 'block', docId: 'new-doc', blockId: 'b1' }
    );
  });

  test('reuses the Fix-ups note and runs on the server without a machine', async () => {
    const { service, createDoc, start } = setup('fix-ups');
    await service.fix({ title: 'Monitor failing', details: [] });

    expect(createDoc).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ deviceKey: 'cloud' }),
      expect.objectContaining({ docId: 'fix-ups' })
    );
  });

  test('remembers the fix, so its agent can be shown again', async () => {
    const { service } = setup('fix-ups');
    const failure = { title: 'Monitor failing', details: [] };
    expect(service.watchFix(fixKey(failure)).value).toBeNull();
    await service.fix(failure);
    expect(service.watchFix(fixKey(failure)).value).toEqual({
      docId: 'fix-ups',
      blockId: 'b1',
      runId: 'run-1',
    });
  });
});

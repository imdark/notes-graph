import test from 'ava';

import { WorkspaceMcpProvider } from '../../plugins/copilot/mcp/provider';
import { RegistryJobService } from '../../plugins/registry/jobs';

/**
 * start_agent_run and agent_run_status of the MCP provider, over a job
 * service that records what it is asked, found through ModuleRef as the
 * real one is.
 */
async function subtaskTools(
  opts: { editable?: boolean; indexed?: string } = {}
) {
  process.env.NOTESGRAPH_MCP_WRITE_TOOLS = 'true';
  const enqueued: { device: string; body: Record<string, unknown> }[] = [];
  const jobs = {
    enqueue: async (
      _ws: string,
      _user: string,
      device: string,
      body: Record<string, unknown>
    ) => {
      enqueued.push({ device, body });
      return {
        id: 'job-sub',
        status: 'queued',
        deviceKey: device,
        runAfter: null,
        title: body.title,
      };
    },
    get: async (_ws: string, id: string) =>
      id === 'job-sub'
        ? {
            id,
            title: 'CLOUD-150 Lift the sheet',
            deviceKey: 'cloud',
            status: 'done',
            runAfter: null,
            createdAt: 1_795_000_000,
            finishedAt: 1_795_000_600,
            result: 'Opened #452.',
            error: null,
            questions: [],
            log: 'done',
            logEnd: 4,
          }
        : null,
  };
  const moduleRef = {
    get: (token: unknown) => {
      if (token !== RegistryJobService) throw new Error('unknown provider');
      return jobs;
    },
  };
  const ac = {
    user: () => ({
      workspace: () => ({
        assert: async () => {},
        doc: () => ({ can: async () => opts.editable ?? true }),
      }),
    }),
  };
  const reader = {
    getDocContent: async () => ({ title: '2026-11-26' }),
  };
  const indexer = {
    search: async () => ({
      nodes: opts.indexed ? [{ fields: { content: opts.indexed } }] : [],
    }),
  };
  const provider = new WorkspaceMcpProvider(
    ac as any,
    reader as any,
    {} as any,
    {} as any,
    indexer as any,
    {} as any,
    undefined,
    moduleRef as any
  );
  const server = await provider.for('user', 'ws');
  const tool = (name: string) => {
    const found = server.tools.find(item => item.name === name);
    if (!found) throw new Error(`${name} is not offered`);
    return (args: Record<string, unknown>) =>
      found.execute(args, { signal: new AbortController().signal });
  };
  return {
    start: tool('start_agent_run'),
    status: tool('agent_run_status'),
    enqueued,
  };
}

const text = (result: { content: { text?: string }[] }) =>
  JSON.parse(result.content[0].text ?? '{}');

test('start_agent_run queues a wf task on the block, on the cloud runner', async t => {
  const { start, enqueued } = await subtaskTools({
    indexed: 'CLOUD-150 Lift the sheet #repo:notes-graph',
  });

  const result = await start({
    docId: 'journal',
    blockId: 'todo-1',
    parentJobId: 'job-parent',
    agent: 'Claude Code',
  });

  t.falsy(result.isError);
  t.like(text(result as any), {
    jobId: 'job-sub',
    status: 'queued',
    device: 'cloud',
  });
  t.is(enqueued.length, 1);
  t.is(enqueued[0].device, 'cloud');
  t.like(enqueued[0].body, {
    model: 'workflow',
    docId: 'journal',
    blockId: 'todo-1',
    title: 'CLOUD-150 Lift the sheet #repo:notes-graph',
  });
  t.regex(String(enqueued[0].body.context), /^Note: 2026-11-26\n/);
  t.regex(String(enqueued[0].body.context), /\(run job-parent\)/);
});

test('start_agent_run takes the kind, device and task text it is given', async t => {
  const { start, enqueued } = await subtaskTools();
  await start({
    docId: 'journal',
    blockId: 'todo-2',
    task: 'Compare three vendors',
    kind: 'research',
    device: 'laptop',
  });
  t.is(enqueued[0].device, 'laptop');
  t.like(enqueued[0].body, {
    model: 'research',
    title: 'Compare three vendors',
  });
});

test("start_agent_run refuses a note it can't edit, and secrets, without queuing", async t => {
  const locked = await subtaskTools({ editable: false });
  t.true((await locked.start({ docId: 'd', blockId: 'b' })).isError);
  t.deepEqual(locked.enqueued, []);

  const open = await subtaskTools();
  const secret = await open.start({
    docId: 'd',
    blockId: 'b',
    instructions:
      'use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ',
  });
  t.true(secret.isError);
  t.deepEqual(open.enqueued, []);
});

test('agent_run_status reports how the run ended', async t => {
  const { status } = await subtaskTools();
  const answer = text((await status({ jobId: 'job-sub' })) as any);
  t.like(answer, { status: 'done', ended: true, result: 'Opened #452.' });

  t.true((await status({ jobId: 'nope' })).isError);
});

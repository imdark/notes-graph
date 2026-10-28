import test from 'ava';

import {
  WorkspaceMcpProvider,
  type WorkspaceMcpToolResult,
} from '../../plugins/copilot/mcp/provider';

/** report_monitor_value against a stub monitor model. */

const text = (result: WorkspaceMcpToolResult) =>
  result.content[0].type === 'text' ? result.content[0].text : '';

async function setup(monitor: Record<string, unknown> | null) {
  process.env.NOTESGRAPH_MCP_WRITE_TOOLS = 'true';
  const updates: any[] = [];
  const models = {
    monitor: {
      get: async () => monitor,
      update: async (id: string, data: any) => updates.push({ id, ...data }),
    },
  };
  const ac = {
    user: () => ({ workspace: () => ({ assert: async () => {} }) }),
  };
  const provider = new WorkspaceMcpProvider(
    ac as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    models as any
  );
  const server = await provider.for('u1', 'ws');
  const tool = server.tools.find(item => item.name === 'report_monitor_value');
  if (!tool) throw new Error('no report_monitor_value tool');
  const call = (args: Record<string, unknown>) =>
    tool.execute(args, { signal: new AbortController().signal });
  return { call, updates };
}

const agentMonitor = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  workspaceId: 'ws',
  createdBy: 'u1',
  kind: 'agent',
  pendingJobId: 'job-1',
  ...over,
});

test('a running agent monitor keeps the reported number', async t => {
  const { call, updates } = await setup(agentMonitor());
  const result = await call({ monitorId: 'm1', value: 1899.5 });
  t.falsy(result.isError);
  t.deepEqual(JSON.parse(text(result)), {
    success: true,
    monitorId: 'm1',
    value: 1899.5,
  });
  t.deepEqual(updates, [{ id: 'm1', reportedValue: '1899.5' }]);
});

test('a number given as text is refused', async t => {
  const { call, updates } = await setup(agentMonitor());
  const result = await call({ monitorId: 'm1', value: '$1,899' });
  t.true(result.isError);
  t.is(updates.length, 0);
});

test("another user's monitor, a check, or one not running is refused", async t => {
  for (const [monitor, message] of [
    [agentMonitor({ createdBy: 'u2' }), /not found/],
    [agentMonitor({ workspaceId: 'other' }), /not found/],
    [agentMonitor({ kind: 'check' }), /Only an agent monitor/],
    [agentMonitor({ pendingJobId: null }), /No run of this monitor/],
  ] as const) {
    const { call, updates } = await setup(monitor);
    const result = await call({ monitorId: 'm1', value: 1 });
    t.true(result.isError);
    t.regex(text(result), message);
    t.is(updates.length, 0);
  }
});

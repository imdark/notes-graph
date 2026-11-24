import test from 'ava';

import { nextPatchVersion } from '../../models/agent-plugin';
import { WorkspaceMcpProvider } from '../../plugins/copilot/mcp/provider';

const CODE = 'export default { activate(ctx) { ctx.ui.notify({ title: "hi" }); } };';

/** The plugin tools over an in-memory store, as a user who is (or isn't) a workspace admin. */
async function pluginTools(admin = true) {
  process.env.NOTESGRAPH_MCP_WRITE_TOOLS = 'true';
  const store = new Map<string, Record<string, unknown>>();
  const ac = {
    user: () => ({
      workspace: () => ({
        assert: async () => {},
        can: async (action: string) =>
          action === 'Workspace.Settings.Update' ? admin : true,
        doc: () => ({ can: async () => true }),
      }),
    }),
  };
  const models = {
    agentPlugin: {
      save: async (input: Record<string, unknown>) => {
        const prev = store.get(input.pluginId as string);
        const version = prev
          ? nextPatchVersion(prev.version as string)
          : '1.0.0';
        const row = {
          ...input,
          version,
          manifest: { id: input.pluginId, name: input.name, version },
        };
        store.set(input.pluginId as string, row);
        return row;
      },
      get: async (_ws: string, id: string) => store.get(id) ?? null,
      list: async () => [...store.values()],
    },
  };
  const provider = new WorkspaceMcpProvider(
    ac as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    models as any
  );
  const server = await provider.for('user', 'ws');
  const tool = (name: string) => {
    const found = server.tools.find(item => item.name === name);
    if (!found) throw new Error(`${name} is not offered`);
    return (args: Record<string, unknown>) =>
      found.execute(args, { signal: new AbortController().signal });
  };
  return { create: tool('create_plugin'), list: tool('list_plugins'), store };
}

const text = (result: { content: unknown[] }) =>
  (result.content[0] as { text: string }).text;

test('create_plugin saves a plugin, then bumps its version on update', async t => {
  const { create, store } = await pluginTools();
  const first = await create({
    id: 'agent.hello',
    name: 'Hello',
    permissions: ['ui', 'ui'],
    code: CODE,
    agent: 'bot',
  });
  t.falsy(first.isError);
  t.is(JSON.parse(text(first)).version, '1.0.0');
  t.deepEqual(store.get('agent.hello')?.permissions, ['ui']);
  t.is(store.get('agent.hello')?.workspaceId, 'ws');

  const second = await create({ id: 'agent.hello', name: 'Hello', code: CODE });
  t.is(JSON.parse(text(second)).version, '1.0.1');
});

test('create_plugin refuses bad ids, permissions, code and non-admins', async t => {
  const { create, store } = await pluginTools();
  t.true((await create({ id: 'hello', name: 'H', code: CODE })).isError);
  t.true(
    (
      await create({
        id: 'agent.h',
        name: 'H',
        permissions: ['native'],
        code: CODE,
      })
    ).isError
  );
  const noExport = await create({ id: 'agent.h', name: 'H', code: 'alert(1)' });
  t.regex(text(noExport), /default export/);
  const secret = await create({
    id: 'agent.h',
    name: 'H',
    code: `${CODE} const k = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ";`,
  });
  t.true(secret.isError);
  t.is(store.size, 0);

  const member = await pluginTools(false);
  const denied = await member.create({ id: 'agent.h', name: 'H', code: CODE });
  t.regex(text(denied), /owner or admin/);
  t.is(member.store.size, 0);
});

test('list_plugins lists without code, and returns the code for one id', async t => {
  const { create, list } = await pluginTools();
  await create({ id: 'agent.hello', name: 'Hello', code: CODE });
  const all = JSON.parse(text(await list({})));
  t.is(all.plugins.length, 1);
  t.false('code' in all.plugins[0]);
  t.is(JSON.parse(text(await list({ id: 'agent.hello' }))).code, CODE);
  t.true((await list({ id: 'agent.nope' })).isError);
});

test('nextPatchVersion bumps the patch and resets anything odd', t => {
  t.is(nextPatchVersion('1.0.0'), '1.0.1');
  t.is(nextPatchVersion('2.3.9'), '2.3.10');
  t.is(nextPatchVersion('junk'), '1.0.0');
  t.is(nextPatchVersion(undefined), '1.0.0');
});

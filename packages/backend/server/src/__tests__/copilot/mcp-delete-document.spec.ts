import test from 'ava';

import { WorkspaceMcpProvider } from '../../plugins/copilot/mcp/provider';

/** delete_document of the MCP provider: to the trash, with its guards. */
async function deleteTool(opts: { canTrash?: boolean; title?: string } = {}) {
  process.env.NOTESGRAPH_MCP_WRITE_TOOLS = 'true';
  const trashed: string[] = [];
  const ac = {
    user: () => ({
      workspace: () => ({
        assert: async () => {},
        doc: () => ({ can: async () => opts.canTrash ?? true }),
      }),
    }),
  };
  const reader = {
    getDocContent: async () => ({ title: opts.title ?? 'Hand-off test' }),
  };
  const writer = {
    trashDoc: async (_ws: string, docId: string) => {
      if (trashed.includes(docId)) return false;
      trashed.push(docId);
      return true;
    },
  };
  const provider = new WorkspaceMcpProvider(
    ac as any,
    reader as any,
    writer as any,
    {} as any,
    {} as any,
    {} as any
  );
  const server = await provider.for('user', 'ws');
  const tool = server.tools.find(item => item.name === 'delete_document');
  if (!tool) throw new Error('delete_document is not offered');
  const call = (args: Record<string, unknown>) =>
    tool.execute(args, { signal: new AbortController().signal });
  return { call, trashed };
}

const answer = (result: any) => JSON.parse(result.content[0].text);

test('moves a note to the trash, and says so when it was there already', async t => {
  const { call, trashed } = await deleteTool();
  t.deepEqual(answer(await call({ docId: 'note-1' })), {
    docId: 'note-1',
    trashed: true,
  });
  t.deepEqual(answer(await call({ docId: 'note-1' })), {
    docId: 'note-1',
    trashed: false,
  });
  t.deepEqual(trashed, ['note-1']);
});

test("refuses the workspace, a journal day, and a note it can't delete", async t => {
  const open = await deleteTool();
  t.true((await open.call({ docId: 'ws' })).isError);

  const journal = await deleteTool({ title: '2026-11-26' });
  const day = await journal.call({ docId: 'journal' });
  t.true(day.isError);
  t.regex((day.content[0] as { text: string }).text, /journal day/);

  const locked = await deleteTool({ canTrash: false });
  t.true((await locked.call({ docId: 'note-1' })).isError);

  t.deepEqual([...open.trashed, ...journal.trashed, ...locked.trashed], []);
});

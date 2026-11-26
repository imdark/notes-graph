import test from 'ava';

import { WorkspaceMcpProvider } from '../../plugins/copilot/mcp/provider';

/** append_to_section of the MCP provider over an in-memory doc store. */
async function appendToSection(docs: Record<string, string>) {
  process.env.NOTESGRAPH_MCP_WRITE_TOOLS = 'true';
  const writes: {
    op: string;
    docId: string;
    heading?: string;
    lines?: string[];
  }[] = [];
  const ac = {
    user: () => ({
      workspace: () => ({
        assert: async () => {},
        doc: (docId: string) => ({ can: async () => docId in docs }),
      }),
    }),
  };
  const reader = {
    getDocMarkdown: async (_ws: string, docId: string) =>
      docId in docs ? { title: 'T', markdown: docs[docId] } : null,
  };
  const writer = {
    updateDoc: async (_ws: string, docId: string) => {
      writes.push({ op: 'update', docId });
    },
    insertUnderHeading: async (
      _ws: string,
      docId: string,
      heading: string,
      lines: string[]
    ) => {
      writes.push({ op: 'insert', docId, heading, lines });
      return { success: true };
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
  const tool = server.tools.find(item => item.name === 'append_to_section');
  if (!tool) throw new Error('append_to_section is not offered');
  const call = (args: Record<string, unknown>) =>
    tool.execute(args, { signal: new AbortController().signal });
  return { call, writes };
}

test('append_to_section inserts the lines and never rewrites the doc', async t => {
  const { call, writes } = await appendToSection({ j1: '## notes-graph' });

  const result = await call({
    docId: 'j1',
    heading: 'notes-graph',
    lines: ['[PERSONAL-1](https://x/1) Fix it'],
    agent: 'wf task create',
  });

  t.falsy(result.isError);
  t.deepEqual(writes, [
    {
      op: 'insert',
      docId: 'j1',
      heading: 'notes-graph',
      lines: ['[PERSONAL-1](https://x/1) Fix it'],
    },
  ]);
});

test('append_to_section refuses unknown docs and secrets without writing', async t => {
  const { call, writes } = await appendToSection({ j1: '## notes-graph' });

  const unknown = await call({ docId: 'nope', heading: 'x', lines: ['a'] });
  t.true(unknown.isError);

  const secret = await call({
    docId: 'j1',
    heading: 'notes-graph',
    lines: ['key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ'],
  });
  t.true(secret.isError);
  t.deepEqual(writes, []);
});

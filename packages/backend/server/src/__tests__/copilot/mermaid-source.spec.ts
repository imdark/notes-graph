import test from 'ava';

import {
  mermaidSource,
  WorkspaceMcpProvider,
} from '../../plugins/copilot/mcp/provider';

/** The MCP provider with write tools on, over an in-memory doc store. */
async function diagramTool(docs: Record<string, string>) {
  process.env.NOTESGRAPH_MCP_WRITE_TOOLS = 'true';
  const writes: { op: string; docId: string; markdown: string }[] = [];
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
    createDoc: async (_ws: string, title: string, markdown: string) => {
      writes.push({ op: 'create', docId: 'new-doc', markdown });
      return { docId: 'new-doc', title };
    },
    updateDoc: async (_ws: string, docId: string, markdown: string) => {
      writes.push({ op: 'update', docId, markdown });
    },
  };
  const provider = new WorkspaceMcpProvider(
    ac as any,
    reader as any,
    writer as any,
    {} as any,
    {} as any
  );
  const server = await provider.for('user', 'ws');
  const tool = server.tools.find(item => item.name === 'create_diagram');
  if (!tool) throw new Error('create_diagram is not offered');
  const call = (args: Record<string, unknown>) =>
    tool.execute(args, { signal: new AbortController().signal });
  return { call, writes };
}

test('create_diagram appends a mermaid block to an existing doc', async t => {
  const { call, writes } = await diagramTool({
    d1: 'Intro paragraph.\n\n> Edited via MCP by bot — 2026-01-01 00:00',
  });
  const result = await call({
    docId: 'd1',
    mermaid: '```mermaid\nflowchart TD\n  A --> B\n```',
    caption: 'The flow',
    agent: 'bot',
  });
  t.falsy(result.isError);
  t.is(JSON.parse(result.content[0].text).docId, 'd1');
  t.is(writes.length, 1);
  const [write] = writes;
  t.is(write.op, 'update');
  t.true(
    write.markdown.startsWith(
      'Intro paragraph.\n\nThe flow\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n> Edited via MCP by bot — '
    )
  );
  // The agent's earlier stamp moved below the diagram, not duplicated.
  t.is(write.markdown.match(/Edited via MCP/g)?.length, 1);
});

test('create_diagram makes a new doc when no docId is given', async t => {
  const { call, writes } = await diagramTool({});
  const missingTitle = await call({ mermaid: 'pie\n  "A": 1' });
  t.true(missingTitle.isError);
  const result = await call({ title: 'Pets', mermaid: 'pie\n  "A": 1' });
  t.falsy(result.isError);
  t.is(JSON.parse(result.content[0].text).docId, 'new-doc');
  t.is(writes[0].op, 'create');
  t.true(writes[0].markdown.startsWith('```mermaid\npie\n  "A": 1\n```'));
});

test('create_diagram refuses prose and unknown docs without writing', async t => {
  const { call, writes } = await diagramTool({ d1: 'x' });
  const prose = await call({ docId: 'd1', mermaid: 'A goes to B' });
  t.true(prose.isError);
  const missing = await call({ docId: 'nope', mermaid: 'graph TD\n  A-->B' });
  t.true(missing.isError);
  t.regex(missing.content[0].text, /not found/);
  t.is(writes.length, 0);
});

test('mermaidSource takes a diagram as written, or off its fence', t => {
  t.is(mermaidSource('flowchart TD\n  A --> B\n'), 'flowchart TD\n  A --> B');
  t.is(
    mermaidSource('```mermaid\nsequenceDiagram\n  A->>B: hi\n```'),
    'sequenceDiagram\n  A->>B: hi'
  );
  t.is(
    mermaidSource('%%{init: {"theme": "dark"}}%%\npie title Pets\n  "Dogs": 3'),
    '%%{init: {"theme": "dark"}}%%\npie title Pets\n  "Dogs": 3'
  );
});

test('mermaidSource refuses what is not a diagram', t => {
  t.deepEqual(mermaidSource('  '), { error: 'The Mermaid source is empty.' });
  const prose = mermaidSource('A goes to B');
  t.true(typeof prose === 'object' && /starts with "A"/.test(prose.error));
  const fenced = mermaidSource('graph TD\n```\nA-->B');
  t.true(typeof fenced === 'object' && /fence/.test(fenced.error));
});

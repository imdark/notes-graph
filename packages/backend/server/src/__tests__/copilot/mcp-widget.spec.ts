import test from 'ava';

import { WorkspaceMcpProvider } from '../../plugins/copilot/mcp/provider';

/**
 * A block-appending tool of the MCP provider with write tools on, over an
 * in-memory doc store.
 */
async function appendTool(name: string, docs: Record<string, string>) {
  process.env.NOTESGRAPH_MCP_WRITE_TOOLS = 'true';
  const writes: { op: string; docId: string; body: string }[] = [];
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
    createDoc: async (_ws: string, _title: string, markdown: string) => {
      writes.push({ op: 'create', docId: 'new-doc', body: markdown });
      return { docId: 'new-doc' };
    },
    updateDoc: async (_ws: string, docId: string, markdown: string) => {
      writes.push({ op: 'update', docId, body: markdown });
    },
    appendHtmlEmbed: async (
      _ws: string,
      docId: string,
      html: string,
      caption: string | null
    ) => {
      writes.push({ op: 'widget', docId, body: `${caption}|${html}` });
    },
    appendFlashcards: async (
      _ws: string,
      docId: string,
      cards: { question: string; answer: string }[]
    ) => {
      writes.push({
        op: 'cards',
        docId,
        body: cards.map(c => `${c.question}=${c.answer}`).join(';'),
      });
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
  const tool = server.tools.find(item => item.name === name);
  if (!tool) throw new Error(`${name} is not offered`);
  const call = (args: Record<string, unknown>) =>
    tool.execute(args, { signal: new AbortController().signal });
  return { call, writes };
}

test('create_widget stamps an existing doc and appends the widget', async t => {
  const { call, writes } = await appendTool('create_widget', { d1: 'Intro.' });
  const result = await call({
    docId: 'd1',
    html: '<button>+1</button>',
    caption: 'Counter\n',
    agent: 'bot',
  });
  t.falsy(result.isError);
  t.deepEqual(
    writes.map(w => w.op),
    ['update', 'widget']
  );
  t.regex(writes[0].body, /^Intro\.\n\n> Edited via MCP by bot — /);
  t.is(writes[1].body, 'Counter|<button>+1</button>');
});

test('create_widget makes a new doc when no docId is given', async t => {
  const { call, writes } = await appendTool('create_widget', {});
  t.true((await call({ html: '<p>x</p>' })).isError);
  const result = await call({ title: 'Quiz', html: '<p>x</p>' });
  t.is(JSON.parse((result.content[0] as { text: string }).text).docId, 'new-doc');
  t.deepEqual(
    writes.map(w => `${w.op}:${w.docId}`),
    ['create:new-doc', 'widget:new-doc']
  );
});

test('create_widget refuses unknown docs and secrets without writing', async t => {
  const { call, writes } = await appendTool('create_widget', { d1: 'x' });
  const missing = await call({ docId: 'nope', html: '<p>x</p>' });
  t.regex((missing.content[0] as { text: string }).text, /not found/);
  const secret = await call({
    docId: 'd1',
    html: '<script>const k = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ"</script>',
  });
  t.true(secret.isError);
  t.is(writes.length, 0);
});

test('create_flashcards stamps an existing doc and appends one-line cards', async t => {
  const { call, writes } = await appendTool('create_flashcards', { d1: 'Intro.' });
  const result = await call({
    docId: 'd1',
    cards: [
      { question: 'Capital of\nFrance?', answer: 'Paris' },
      { question: '2 + 2?', answer: '4' },
    ],
    agent: 'bot',
  });
  t.falsy(result.isError);
  t.is(JSON.parse((result.content[0] as { text: string }).text).cards, 2);
  t.deepEqual(
    writes.map(w => w.op),
    ['update', 'cards']
  );
  t.regex(writes[0].body, /^Intro\.\n\n> Edited via MCP by bot — /);
  t.is(writes[1].body, 'Capital of France?=Paris;2 + 2?=4');
});

test('create_flashcards needs a title for a new doc and refuses empty cards', async t => {
  const { call, writes } = await appendTool('create_flashcards', {});
  const card = { question: 'Q', answer: 'A' };
  t.true((await call({ cards: [card] })).isError);
  t.true(
    (await call({ title: 'Deck', cards: [{ question: 'Q', answer: ' ' }] }))
      .isError
  );
  t.is(writes.length, 0);
  const result = await call({ title: 'Deck', cards: [card] });
  t.is(JSON.parse((result.content[0] as { text: string }).text).docId, 'new-doc');
  t.deepEqual(
    writes.map(w => `${w.op}:${w.docId}`),
    ['create:new-doc', 'cards:new-doc']
  );
});

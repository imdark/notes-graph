import test from 'ava';

import { commentText, replyContent } from '../../plugins/copilot/mcp/comments';
import { WorkspaceMcpProvider } from '../../plugins/copilot/mcp/provider';

function typed(...lines: string[]) {
  return replyContent(lines.join('\n'));
}

/** The MCP provider with write tools on, over in-memory comments. */
async function commentTools(docs: string[]) {
  process.env.NOTESGRAPH_MCP_WRITE_TOOLS = 'true';
  const comments = [
    {
      id: 'c1',
      workspaceId: 'ws',
      docId: 'd1',
      userId: 'u1',
      resolved: false,
      createdAt: new Date('2026-10-21T08:00:00Z'),
      content: {
        ...typed('Make this shorter', 'and cite it'),
        preview: 'Long para',
      },
      replies: [] as any[],
    },
    {
      id: 'c2',
      workspaceId: 'ws',
      docId: 'd1',
      userId: 'u1',
      resolved: true,
      createdAt: new Date('2026-10-20T08:00:00Z'),
      content: typed('Old note'),
      replies: [],
    },
  ];
  const replies: any[] = [];
  const resolved: string[] = [];
  const models = {
    comment: {
      list: async (_ws: string, docId: string) =>
        comments.filter(c => c.docId === docId),
      get: async (id: string) => comments.find(c => c.id === id) ?? null,
      createReply: async (input: any) => replies.push(input),
      resolve: async (input: any) => resolved.push(input.id),
    },
    user: {
      getPublicUsersMap: async () => new Map([['u1', { name: 'Mike' }]]),
    },
  };
  const ac = {
    user: () => ({
      workspace: () => ({
        assert: async () => {},
        doc: (docId: string) => ({
          can: async () => docs.includes(docId),
          assert: async () => {},
        }),
      }),
    }),
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
  return { tool, replies, resolved };
}

test('commentText reads a comment snapshot as lines', t => {
  t.is(commentText(typed('one', 'two')), 'one\ntwo');
  t.is(commentText({}), '');
  t.is(commentText(null), '');
});

test('read_comments returns open comments with quote and text', async t => {
  const { tool } = await commentTools(['d1']);
  const result = await tool('read_comments')({ docId: 'd1' });
  t.falsy(result.isError);
  const { comments } = JSON.parse((result.content[0] as { text: string }).text);
  t.is(comments.length, 1);
  t.like(comments[0], {
    id: 'c1',
    author: 'Mike',
    quote: 'Long para',
    text: 'Make this shorter\nand cite it',
    resolved: false,
  });

  const all = await tool('read_comments')({
    docId: 'd1',
    includeResolved: true,
  });
  t.is(
    JSON.parse((all.content[0] as { text: string }).text).comments.length,
    2
  );

  const hidden = await tool('read_comments')({ docId: 'd2' });
  t.true(hidden.isError);
});

test('reply_to_comment replies, signs and resolves', async t => {
  const { tool, replies, resolved } = await commentTools(['d1']);
  const result = await tool('reply_to_comment')({
    commentId: 'c1',
    text: 'Shortened it.',
    resolve: true,
    agent: 'bot',
  });
  t.falsy(result.isError);
  t.is(replies.length, 1);
  t.is(replies[0].userId, 'user');
  t.is(commentText(replies[0].content), 'Shortened it.\n— bot, via MCP');
  t.deepEqual(resolved, ['c1']);
});

test('reply_to_comment refuses nothing to do and hidden comments', async t => {
  const { tool, replies, resolved } = await commentTools([]);
  t.true((await tool('reply_to_comment')({ commentId: 'c1' })).isError);
  const hidden = await tool('reply_to_comment')({ commentId: 'c1', text: 'x' });
  t.regex((hidden.content[0] as { text: string }).text, /not found/);
  t.is(replies.length + resolved.length, 0);
});

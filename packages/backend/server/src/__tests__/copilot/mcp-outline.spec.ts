import test from 'ava';

import type { DocReader } from '../../core/doc';
import { createDocWithMarkdown } from '../../native';
import {
  buildOutline,
  loadOutlineSource,
  type OutlineSource,
  readSection,
} from '../../plugins/copilot/mcp/outline';
import { WorkspaceMcpProvider } from '../../plugins/copilot/mcp/provider';
import { ToolRuntime } from '../../plugins/copilot/runtime/tool-runtime';
import {
  createDocOutlineTool,
  createDocReadSectionTool,
} from '../../plugins/copilot/tools/doc-outline';

const DOC_ID = 'outline-doc';

const markdown = [
  'intro para',
  '',
  '# Title',
  '',
  'title body',
  '',
  '## A',
  '',
  'a body',
  '',
  '```',
  '# not a heading',
  '```',
  '',
  '- item one',
  '  - nested',
  '',
  '### A1',
  '',
  'deep',
  '',
  '## B',
  '',
  'b body',
  '',
  '\\# a paragraph that starts with a hash',
].join('\n');

const bin = createDocWithMarkdown('Long note', markdown, DOC_ID);
const reader = {
  getDoc: async (_workspaceId: string, docId: string) =>
    docId === DOC_ID
      ? { spaceId: 'ws', docId, bin, timestamp: Date.now() }
      : null,
} as unknown as DocReader;

async function load(): Promise<OutlineSource> {
  const source = await loadOutlineSource(reader, 'ws', DOC_ID);
  if (!source) throw new Error('doc not loaded');
  return source;
}

const titleOf = (source: OutlineSource, title: string) => {
  const heading = buildOutline(source.markdown, source.headings).headings.find(
    h => h.title === title
  );
  if (!heading) throw new Error(`no heading ${title}`);
  return heading;
};

test('outline lists real heading blocks, with block ids and parents', async t => {
  const source = await load();
  t.is(source.title, 'Long note');
  const outline = buildOutline(source.markdown, source.headings);

  // a fenced "# not a heading" and an escaped "\#" paragraph are not headings
  t.deepEqual(
    outline.headings.map(h => [h.level, h.title]),
    [
      [1, 'Title'],
      [2, 'A'],
      [3, 'A1'],
      [2, 'B'],
    ]
  );
  const [title, a, a1, b] = outline.headings;
  t.is(title.parentBlockId, null);
  t.is(a.parentBlockId, title.blockId);
  t.is(a1.parentBlockId, a.blockId);
  t.is(b.parentBlockId, title.blockId);
  for (const h of outline.headings) {
    t.regex(h.blockId, /^\S+$/);
    t.true(source.headings.has(h.blockId));
  }

  // sizes nest: A holds A1, Title holds everything after it
  t.true(a.length > a1.length);
  t.is(a.blocks, 6); // heading, body, code, list, A1, deep
  t.is(a1.blocks, 2);
  t.is(b.blocks, 3);
  t.is(title.blocks, 2 + a.blocks + b.blocks);

  t.truthy(outline.intro);
  t.is(outline.intro?.blocks, 1);
  t.is(outline.length, outline.intro!.length + title.length);
  // the outline is far smaller than the doc it describes
  t.false(JSON.stringify(outline).includes('a body'));
});

test('read_section stops at the next peer heading and keeps block ids', async t => {
  const source = await load();
  const a = titleOf(source, 'A');
  const section = readSection(source.markdown, source.headings, a.blockId);
  if (!section) return t.fail();

  t.true(section.markdown.startsWith(`<!-- block_id=${a.blockId} `));
  t.true(section.markdown.includes('## A'));
  t.true(section.markdown.includes('a body'));
  t.true(section.markdown.includes('# not a heading'));
  t.true(section.markdown.includes('### A1'));
  t.true(section.markdown.includes('deep'));
  t.false(section.markdown.includes('## B'));
  t.false(section.markdown.includes('b body'));
  t.is(section.blockIds.length, a.blocks);
  t.is(section.blockIds[0], a.blockId);

  const b = titleOf(source, 'B');
  const last = readSection(source.markdown, source.headings, b.blockId);
  t.true(last?.markdown.includes('b body'));
  t.true(last?.markdown.includes('a paragraph that starts with a hash'));
});

test('read_section on the intro block reads up to the first heading', async t => {
  const source = await load();
  const { intro } = buildOutline(source.markdown, source.headings);
  const section = readSection(source.markdown, source.headings, intro!.blockId);
  t.deepEqual(section?.blockIds, [intro!.blockId]);
  t.true(section?.markdown.includes('intro para'));
  t.false(section?.markdown.includes('# Title'));
});

test('unknown blocks and docs', async t => {
  const source = await load();
  t.is(readSection(source.markdown, source.headings, 'nope'), null);
  t.is(await loadOutlineSource(reader, 'ws', 'missing'), null);

  const empty = buildOutline('', new Map());
  t.deepEqual(empty, { length: 0, intro: null, headings: [] });
});

test('copilot doc_outline and doc_read_section tools', async t => {
  const source = await load();
  const getSource = async (docId?: string) =>
    docId === DOC_ID
      ? source
      : {
          type: 'error' as const,
          name: 'Doc Outline Failed',
          message: 'nope',
        };
  const outlineTool = createDocOutlineTool(getSource);
  const sectionTool = createDocReadSectionTool(getSource);
  const ctx = { toolCallId: 't', messages: [] } as any;

  const outline: any = await outlineTool.execute!({ doc_id: DOC_ID }, ctx);
  t.is(outline.title, 'Long note');
  t.is(outline.headings.length, 4);

  const b = outline.headings[3];
  const section: any = await sectionTool.execute!(
    { doc_id: DOC_ID, block_id: b.blockId },
    ctx
  );
  t.true(section.markdown.includes('b body'));

  const missing: any = await sectionTool.execute!(
    { doc_id: DOC_ID, block_id: 'nope' },
    ctx
  );
  t.is(missing.type, 'error');
  const denied: any = await outlineTool.execute!({ doc_id: 'other' }, ctx);
  t.is(denied.type, 'error');
});

test('the in-app copilot gets the outline tools along with doc_read', async t => {
  const allow = { can: async () => true };
  const ac = { user: () => ({ workspace: () => ({ doc: () => allow }) }) };
  const models = { workspace: { get: async () => ({ id: 'ws' }) } };
  const runtime = new ToolRuntime(
    {} as any,
    ac as any,
    {} as any,
    reader,
    {} as any,
    models as any,
    {} as any,
    {} as any
  );
  const options = { tools: ['docRead'], user: 'u', workspace: 'ws' } as any;
  const tools = await runtime.getTools(options, 'gpt-4o-mini');
  t.truthy(tools.doc_read);
  t.truthy(tools.doc_read_section);

  const outline: any = await tools.doc_outline.execute!({ doc_id: DOC_ID }, {});
  t.deepEqual(
    outline.headings.map((h: { title: string }) => h.title),
    ['Title', 'A', 'A1', 'B']
  );
  const none = await runtime.getTools({ ...options, tools: [] }, 'gpt-4o-mini');
  t.falsy(none.doc_outline);
});

test('MCP doc_outline and read_section', async t => {
  const readable = new Set([DOC_ID]);
  const ac = {
    user: () => ({
      workspace: () => ({
        assert: async () => {},
        doc: (docId: string) => ({ can: async () => readable.has(docId) }),
      }),
    }),
  };
  const provider = new WorkspaceMcpProvider(
    ac as any,
    reader,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  const server = await provider.for('u', 'ws');
  const signal = new AbortController().signal;
  const call = async (name: string, args: Record<string, unknown>) => {
    const tool = server.tools.find(item => item.name === name);
    if (!tool) throw new Error('no tool ' + name);
    return (await tool.execute(args, { signal })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
  };

  const outlined = await call('doc_outline', { docId: DOC_ID });
  t.falsy(outlined.isError);
  const outline = JSON.parse(outlined.content[0].text);
  t.is(outline.docId, DOC_ID);
  t.is(outline.title, 'Long note');
  const a = outline.headings[1];
  t.is(a.title, 'A');

  const read = await call('read_section', {
    docId: DOC_ID,
    blockId: a.blockId,
  });
  t.falsy(read.isError);
  t.true(read.content[0].text.includes('### A1'));
  t.false(read.content[0].text.includes('## B'));

  const missing = await call('read_section', { docId: DOC_ID, blockId: 'x' });
  t.true(missing.isError);
  readable.delete(DOC_ID);
  const denied = await call('doc_outline', { docId: DOC_ID });
  t.true(denied.isError);
  t.regex(denied.content[0].text, /not found/);
});

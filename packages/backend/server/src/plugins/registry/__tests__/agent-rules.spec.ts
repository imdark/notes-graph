import test from 'ava';
import * as Y from 'yjs';

import { profileFor } from '../agent-profiles';
import {
  AGENT_RULES_TITLE,
  AgentRules,
  agentRulesSection,
  contextProjects,
  docTagNames,
  inlineTags,
  MAX_AGENT_RULES_CHARS,
  SCOPED_RULES_SENTENCE,
  withAgentRules,
} from '../agent-rules';
import { RegistryJobService } from '../jobs';

/**
 * The "Agent rules" note: found by title, read as whoever started the run,
 * and appended to the profile a runner gets when it claims a job. Against
 * stub Models, DocReader and permissions.
 */

const workspaceId = 'ws-1';

/** A workspace root doc listing `pages`, the way the client writes it. */
function rootDoc(pages: { id: string; trash?: boolean }[]) {
  const doc = new Y.Doc();
  const list = new Y.Array<Y.Map<unknown>>();
  doc.getMap('meta').set('pages', list);
  list.push(
    pages.map(page => {
      const map = new Y.Map<unknown>();
      map.set('id', page.id);
      map.set('title', AGENT_RULES_TITLE);
      if (page.trash) map.set('trash', true);
      return map;
    })
  );
  return Y.encodeStateAsUpdate(doc);
}

function makeRules(options: {
  ids?: string[];
  docs?: Record<string, string>;
  readable?: string[];
  fail?: boolean;
  /** The root doc's pages; without, there is no root doc. */
  pages?: { id: string; trash?: boolean }[];
}) {
  const asked: { title?: string; read: string[]; checked: string[] } = {
    read: [],
    checked: [],
  };
  const models: any = {
    doc: {
      findIdsByTitle: async (_ws: string, title: string) => {
        if (options.fail) throw new Error('db down');
        asked.title = title;
        return options.ids ?? [];
      },
      getSnapshot: async () =>
        options.pages ? { blob: rootDoc(options.pages) } : null,
    },
  };
  const reader: any = {
    getDocMarkdown: async (_ws: string, docId: string) => {
      asked.read.push(docId);
      const markdown = options.docs?.[docId];
      return markdown === undefined
        ? null
        : { title: AGENT_RULES_TITLE, markdown };
    },
  };
  const ac: any = {
    user: () => ({
      workspace: () => ({
        doc: (docId: string) => ({
          can: async () => {
            asked.checked.push(docId);
            return !options.readable || options.readable.includes(docId);
          },
        }),
      }),
    }),
  };
  return { rules: new AgentRules(models, reader, ac), asked };
}

test('no note, or an empty one, adds nothing', t => {
  t.is(agentRulesSection(null), null);
  t.is(agentRulesSection('  \n '), null);
  const profile = profileFor('claude-code')!;
  t.is(withAgentRules(profile, null), profile);
});

test('the note is appended after the built-in conventions and said to win', t => {
  const profile = profileFor('claude-code')!;
  const ruled = withAgentRules(
    profile,
    '- Research notes go under "Research".'
  );
  t.true(ruled.systemPrompt.startsWith(profile.systemPrompt));
  t.regex(
    ruled.systemPrompt,
    /Agent memory[\s\S]*"Agent rules"[\s\S]*take precedence over any built-in conventions[\s\S]*<agent-rules>\n- Research notes go under "Research"\.\n<\/agent-rules>/
  );
  // The rest of the profile is untouched.
  t.deepEqual(ruled.allowedTools, profile.allowedTools);
});

test('a long note is cut, and the agent told so', t => {
  const section = agentRulesSection('x'.repeat(MAX_AGENT_RULES_CHARS + 500))!;
  t.true(section.includes('x'.repeat(MAX_AGENT_RULES_CHARS)));
  t.false(section.includes('x'.repeat(MAX_AGENT_RULES_CHARS + 1)));
  t.true(section.endsWith('\n[the rest of the note was cut]\n</agent-rules>'));
});

test('reads the first note of that title the user can open and has text', async t => {
  const { rules, asked } = makeRules({
    ids: ['secret', 'empty', 'rules', 'later'],
    readable: ['empty', 'rules', 'later'],
    docs: {
      secret: 'hidden',
      empty: '  ',
      rules: ' Tag research #research \n',
      later: 'no',
    },
  });
  t.is(await rules.read(workspaceId, 'user-1'), 'Tag research #research');
  t.is(asked.title, AGENT_RULES_TITLE);
  t.deepEqual(asked.read, ['empty', 'rules']);
});

test('a note in the trash does not count', async t => {
  const { rules, asked } = makeRules({
    ids: ['trashed', 'rules'],
    docs: { trashed: 'old rules', rules: 'new rules' },
    pages: [{ id: 'trashed', trash: true }, { id: 'rules' }],
  });
  t.is(await rules.read(workspaceId, 'user-1'), 'new rules');
  t.deepEqual(asked.read, ['rules']);

  const onlyTrashed = makeRules({
    ids: ['trashed'],
    docs: { trashed: 'old rules' },
    pages: [{ id: 'trashed', trash: true }],
  });
  t.is(await onlyTrashed.rules.read(workspaceId, 'user-1'), null);
});

test('a job the server queued itself reads the note without a user to check', async t => {
  const { rules, asked } = makeRules({ ids: ['rules'], docs: { rules: 'r' } });
  t.is(await rules.read(workspaceId, null), 'r');
  t.deepEqual(asked.checked, []);
});

test('no note, or one that fails to read, is no rules rather than an error', async t => {
  t.is(await makeRules({}).rules.read(workspaceId, 'user-1'), null);
  t.is(await makeRules({ fail: true }).rules.read(workspaceId, 'user-1'), null);
});

test('a claimed job gets the rules in its profile; a job of no Claude model gets none', async t => {
  const job = (model: string | null) => ({
    id: 'job-1',
    workspaceId,
    deviceKey: 'laptop',
    agentId: 'a1',
    agentName: 'Worker',
    instructions: 'go',
    context: '',
    model,
    tools: [],
    maxSteps: 8,
    status: 'running',
    createdBy: 'user-1',
    createdAt: new Date(0),
  });
  const reads: (string | null | undefined)[] = [];
  const rules: any = {
    read: async (_ws: string, userId?: string | null) => {
      reads.push(userId);
      return 'Name notes in sentence case.\n## For agent: Other\n* not for Worker';
    },
    runContext: async (claimed: { agentName: string }) => ({
      agents: [claimed.agentName],
    }),
  };
  const claimWith = (model: string | null) =>
    new RegistryJobService(
      { registryJob: { claim: async () => job(model) } } as any,
      undefined,
      undefined,
      undefined,
      rules
    ).claim(workspaceId, 'laptop', 'runner');

  const claimed = await claimWith('claude-code');
  t.regex(
    claimed?.profile?.systemPrompt ?? '',
    /<agent-rules>\nName notes in sentence case\.\n<\/agent-rules>/
  );
  t.false((claimed?.profile?.systemPrompt ?? '').includes('not for Worker'));
  t.deepEqual(reads, ['user-1']);

  t.is((await claimWith(null))?.profile, null);
  t.is(reads.length, 1);
});

const SCOPED_NOTE = [
  '## Writing',
  '* w1',
  '## For project: notes-graph',
  '* p1',
  '## For tag: mobile',
  '* m1',
].join('\n');

test('the section keeps only the "For" parts that match the run, and says so', t => {
  const plain = agentRulesSection('* w1')!;
  t.false(plain.includes(SCOPED_RULES_SENTENCE));

  const none = agentRulesSection(SCOPED_NOTE, {})!;
  t.false(none.includes(SCOPED_RULES_SENTENCE));
  t.true(none.includes('<agent-rules>\n## Writing\n* w1\n</agent-rules>'));

  const mobile = agentRulesSection(SCOPED_NOTE, { tags: ['Mobile'] })!;
  t.true(
    mobile.includes(
      `take precedence over any built-in conventions you were given.\n${SCOPED_RULES_SENTENCE}\n`
    )
  );
  t.true(mobile.includes('## For tag: mobile\n* m1\n</agent-rules>'));
  t.false(mobile.includes('p1'));

  // Nothing left for this run is no rules at all.
  t.is(agentRulesSection('## For agent: Other\n* o', { agents: ['Me'] }), null);
});

test('the cap applies to what is left after filtering', t => {
  const note = `## For agent: Other\n${'o'.repeat(MAX_AGENT_RULES_CHARS)}\n## Mine\nshort`;
  const section = agentRulesSection(note, { agents: ['Me'] })!;
  t.true(section.includes('<agent-rules>\n## Mine\nshort\n</agent-rules>'));
});

/** A root doc whose page `doc-1` carries tag ids, named by the tag property. */
function taggedRootDoc() {
  const doc = new Y.Doc();
  const meta = doc.getMap('meta');
  const pages = new Y.Array<Y.Map<unknown>>();
  meta.set('pages', pages);
  const page = new Y.Map<unknown>();
  page.set('id', 'doc-1');
  const tags = new Y.Array<string>();
  tags.push(['t-mobile', 't-gone']);
  page.set('tags', tags);
  pages.push([page]);
  const properties = new Y.Map<unknown>();
  const tagProp = new Y.Map<unknown>();
  const options = new Y.Array<Y.Map<unknown>>();
  const option = new Y.Map<unknown>();
  option.set('id', 't-mobile');
  option.set('value', 'Mobile');
  options.push([option]);
  tagProp.set('options', options);
  properties.set('tags', tagProp);
  meta.set('properties', properties);
  return Y.encodeStateAsUpdate(doc);
}

test('reads tags, projects and #tags for the run context', t => {
  t.deepEqual(docTagNames(taggedRootDoc(), 'doc-1'), ['Mobile']);
  t.deepEqual(docTagNames(taggedRootDoc(), 'other'), []);
  t.deepEqual(inlineTags('fix it #Android #status:done see a.com/x#frag'), [
    'android',
  ]);
  t.deepEqual(
    contextProjects('Under: x\nProject: Notes Graph (projectId: p1)\n'),
    ['Notes Graph']
  );
});

test("a job's run context: its agent, its note's project and tags, and its #tags", async t => {
  const models: any = {
    doc: { getSnapshot: async () => ({ blob: taggedRootDoc() }) },
    project: {
      getDocProject: async (_ws: string, docId: string) =>
        docId === 'doc-1' ? { projectId: 'p1' } : null,
      get: async () => ({ id: 'p1', name: 'notes-graph' }),
    },
  };
  const rules = new AgentRules(models, {} as any, {} as any);
  const ctx = await rules.runContext({
    workspaceId,
    agentId: 'a1',
    agentName: 'Researcher',
    docId: 'doc-1',
    context: 'Project: Side (projectId: p2)\n\n[ ] ship it #web',
  });
  t.deepEqual(ctx, {
    agents: ['Researcher', 'a1'],
    projects: ['Side', 'notes-graph'],
    tags: ['web', 'Mobile'],
  });

  // A failing lookup leaves out what it would have added.
  const broken = new AgentRules(
    {
      project: {
        getDocProject: async () => {
          throw new Error('db down');
        },
      },
    } as any,
    {} as any,
    {} as any
  );
  t.deepEqual(
    await broken.runContext({
      workspaceId,
      agentId: 'a1',
      agentName: 'W',
      docId: 'doc-1',
      context: '',
    }),
    { agents: ['W', 'a1'], projects: [], tags: [] }
  );
});

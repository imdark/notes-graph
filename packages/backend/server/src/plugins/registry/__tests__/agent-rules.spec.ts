import test from 'ava';
import * as Y from 'yjs';

import { profileFor } from '../agent-profiles';
import {
  AGENT_RULES_TITLE,
  agentRulesSection,
  AgentRules,
  MAX_AGENT_RULES_CHARS,
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
      return markdown === undefined ? null : { title: AGENT_RULES_TITLE, markdown };
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
  const ruled = withAgentRules(profile, '- Research notes go under "Research".');
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
    docs: { secret: 'hidden', empty: '  ', rules: ' Tag research #research \n', later: 'no' },
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
      return 'Name notes in sentence case.';
    },
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
  t.regex(claimed?.profile?.systemPrompt ?? '', /<agent-rules>\nName notes in sentence case\.\n<\/agent-rules>/);
  t.deepEqual(reads, ['user-1']);

  t.is((await claimWith(null))?.profile, null);
  t.is(reads.length, 1);
});

import test from 'ava';

import { profileFor, SKILL_CATALOG } from '../agent-profiles';
import { RegistryJobService } from '../jobs';
import {
  noteSkillDocId,
  noteSkillPath,
  noteSkillRef,
  pickNoteSkills,
  renderSkillMd,
  skillNoteName,
  SkillNoteService,
} from '../skill-notes';

/** The frontmatter fields of a SKILL.md, as Claude Code would read them. */
function frontmatter(text: string) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error('no frontmatter');
  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const at = line.indexOf(':');
    const value = line.slice(at + 1).trim();
    fields[line.slice(0, at)] = value.startsWith('"') ? JSON.parse(value) : value;
  }
  return { fields, body: text.slice(match[0].length) };
}

test('only notes titled "Skill: <name>" are skills, named as Claude Code wants', t => {
  t.is(skillNoteName('Skill: Deploy to prod'), 'deploy-to-prod');
  t.is(skillNoteName('  skill:release_notes v2 '), 'release-notes-v2');
  t.is(skillNoteName('SKILL: Café crème'), 'cafe-creme');
  t.is(skillNoteName('Skills I want to learn'), null);
  t.is(skillNoteName('Deploy skill: notes'), null);
  t.is(skillNoteName('Skill:'), null);
  t.is(skillNoteName('Skill: !!!'), null);
  t.is(skillNoteName(null), null);
  t.true(skillNoteName(`Skill: ${'a'.repeat(100)}`)!.length <= 64);
});

test('a skill note renders to SKILL.md, described by its first paragraph', t => {
  const text = renderSkillMd({
    title: 'Skill: Deploy',
    markdown:
      '# Skill: Deploy\n\n' +
      '## When\n\n' +
      'Ship **main** to [prod](https://example.com) the\nsafe way.\n\n' +
      '1. Merge first\n2. Run `scripts/deploy-bg.sh`\n',
  })!;
  const { fields, body } = frontmatter(text);
  t.deepEqual(fields, {
    name: 'deploy',
    description: 'Ship main to prod the safe way.',
  });
  // The note's own title heading isn't repeated under the skill's.
  t.is(body.match(/^# /gm)?.length, 1);
  t.true(body.startsWith('\n# Deploy\n\n## When\n'));
  t.true(body.includes('2. Run `scripts/deploy-bg.sh`'));
});

test('a "Description:" line wins over the first paragraph and leaves the body', t => {
  const text = renderSkillMd({
    title: 'Skill: Triage',
    markdown:
      'Some preamble.\n\n**Description:** Use when a "prod" alert fires: triage it.\n\nSteps follow.',
  })!;
  const { fields, body } = frontmatter(text);
  t.is(fields.description, 'Use when a "prod" alert fires: triage it.');
  t.false(body.includes('Description'));
  t.true(body.includes('Some preamble.'));
  t.true(body.includes('Steps follow.'));
});

test('a list or quote counts as the first paragraph; code and headings do not', t => {
  const fromList = frontmatter(
    renderSkillMd({
      title: 'Skill: Check',
      markdown: '## Steps\n\n```sh\nrm -rf /\n```\n\n- [ ] Look at the logs\n- Fix it\n',
    })!
  );
  t.is(fromList.fields.description, 'Look at the logs Fix it');
  const fromQuote = frontmatter(
    renderSkillMd({ title: 'Skill: Q', markdown: '> Answer *politely*.' })!
  );
  t.is(fromQuote.fields.description, 'Answer politely.');
});

test('an empty skill note still renders, with a description of its own', t => {
  const { fields, body } = frontmatter(renderSkillMd({ title: 'Skill: Empty', markdown: '' })!);
  t.is(fields.name, 'empty');
  t.is(fields.description, 'Empty, from a NotesGraph note.');
  t.is(body, '\n# Empty\n\n\n');
});

test('a long description is clipped to Claude Code’s limit', t => {
  const { fields } = frontmatter(
    renderSkillMd({ title: 'Skill: Long', markdown: 'word '.repeat(400) })!
  );
  t.true(fields.description.length <= 1024);
  t.true(fields.description.endsWith('…'));
});

test('a note that is not a skill does not render', t => {
  t.is(renderSkillMd({ title: 'Deploy runbook', markdown: 'steps' }), null);
});

test('skill note refs and where their SKILL.md is served', t => {
  t.is(noteSkillRef('doc-1'), 'note:doc-1');
  t.is(noteSkillDocId('note:doc-1'), 'doc-1');
  t.is(noteSkillDocId('note:'), null);
  t.is(noteSkillDocId('antislop'), null);
  t.is(noteSkillPath('ws 1', 'doc/1'), '/api/registry/workspaces/ws%201/skills/doc%2F1/SKILL.md');
});

test('a job gets only the skill notes it names that are skills in its workspace', t => {
  const notes = [
    { docId: 'a', title: 'Skill: Deploy' },
    { docId: 'b', title: 'Groceries' },
    { docId: 'c', title: 'Skill: Triage' },
  ];
  const picked = pickNoteSkills(
    'ws-1',
    ['note:c', 'note:b', 'note:a', 'note:missing', 'note:c', 'antislop', 42],
    notes
  );
  t.deepEqual(picked, [
    { ref: 'note:c', skill: { name: 'triage', url: '/api/registry/workspaces/ws-1/skills/c/SKILL.md' } },
    { ref: 'note:a', skill: { name: 'deploy', url: '/api/registry/workspaces/ws-1/skills/a/SKILL.md' } },
  ]);
});

test('profileFor takes catalog skills and the looked-up skill notes, nothing else', t => {
  const noteSkills = pickNoteSkills('ws-1', ['note:a'], [{ docId: 'a', title: 'Skill: Deploy' }]);
  const profile = profileFor(
    'claude-code',
    ['antislop-ui', 'note:a', 'note:elsewhere', 'https://evil.example/SKILL.md'],
    noteSkills
  );
  t.deepEqual(profile?.skills, [
    SKILL_CATALOG.find(s => s.name === 'antislop-ui'),
    { name: 'deploy', url: '/api/registry/workspaces/ws-1/skills/a/SKILL.md' },
  ]);
  // A skill note the job didn't name isn't added.
  t.deepEqual(
    profileFor('claude-code', ['antislop-ui'], noteSkills)?.skills.map(s => s.name),
    ['antislop-ui']
  );
  // Without a list of its own the job keeps the model's defaults.
  t.deepEqual(profileFor('claude-code', null, noteSkills), profileFor('claude-code'));
});

test('a claimed job gets its skill notes from its own workspace, readable by its starter', async t => {
  const asked: any[] = [];
  const models: any = {
    registryDevice: { touchRunner: async () => {} },
    registryJob: {
      claim: async () => ({
        id: 'job-1',
        workspaceId: 'ws-1',
        deviceKey: 'cloud',
        agentId: 'a',
        agentName: 'a',
        instructions: 'deploy',
        context: '',
        model: 'claude-code',
        tools: [],
        maxSteps: 8,
        status: 'running',
        createdBy: 'user-1',
        skills: ['note:a', 'note:secret', 'antislop'],
        createdAt: new Date(0),
      }),
    },
    doc: {
      findByTitlePrefix: async (workspaceId: string, prefix: string, docIds?: string[]) => {
        asked.push({ workspaceId, prefix, docIds });
        return [
          { docId: 'a', title: 'Skill: Deploy' },
          { docId: 'secret', title: 'Skill: Secret' },
        ];
      },
    },
  };
  // The job's starter can't read "secret", so the run doesn't get it either.
  const ac: any = {
    user: (userId: string) => ({
      doc: (_ws: string, docId: string) => ({
        can: async () => userId === 'user-1' && docId !== 'secret',
      }),
    }),
  };
  const skillNotes = new SkillNoteService(models, {} as any, ac);
  const service = new RegistryJobService(
    models,
    undefined,
    undefined,
    undefined,
    undefined,
    skillNotes
  );
  const claimed = await service.claim('ws-1', 'cloud', 'runner');
  t.deepEqual(asked, [{ workspaceId: 'ws-1', prefix: 'skill', docIds: ['a', 'secret'] }]);
  t.deepEqual(claimed?.profile?.skills, [
    SKILL_CATALOG.find(s => s.name === 'antislop'),
    { name: 'deploy', url: '/api/registry/workspaces/ws-1/skills/a/SKILL.md' },
  ]);
});

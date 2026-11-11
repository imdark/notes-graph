import test from 'ava';

import {
  filterAgentRules,
  normalizeScopeName,
  parseScopeHeading,
} from '../scoped-rules';

/**
 * The scoped-rules spec's test cases. The frontend copy
 * (agents/services/scoped-rules.spec.ts) and wf's Python have the same ones.
 */

const NOTE = [
  'intro line',
  '## Writing',
  '* w1',
  '## For project: notes-graph',
  '* p1',
  '### Details',
  '* p1-detail',
  '## For tag: mobile, #android',
  '* m1',
  '### For agent: Researcher',
  '* m1-researcher',
  '## For agent: Researcher',
  '* r1',
  '## Learned',
  '* l1',
].join('\n');

const lines = (...l: string[]) => l.join('\n');
const UNSCOPED_HEAD = ['intro line', '## Writing', '* w1'];
const UNSCOPED_TAIL = ['## Learned', '* l1'];

test('no context: only the unscoped text', t => {
  t.deepEqual(filterAgentRules(NOTE, {}), {
    text: lines(...UNSCOPED_HEAD, ...UNSCOPED_TAIL),
    keptScoped: false,
  });
});

test('a project, matched however it is written, keeps its section and the headings in it', t => {
  t.deepEqual(filterAgentRules(NOTE, { projects: ['Notes Graph'] }), {
    text: lines(
      ...UNSCOPED_HEAD,
      '## For project: notes-graph',
      '* p1',
      '### Details',
      '* p1-detail',
      ...UNSCOPED_TAIL
    ),
    keptScoped: true,
  });
});

test('a tag matches any of the values; a nested section needs its own match too', t => {
  t.deepEqual(filterAgentRules(NOTE, { tags: ['Android'] }), {
    text: lines(
      ...UNSCOPED_HEAD,
      '## For tag: mobile, #android',
      '* m1',
      ...UNSCOPED_TAIL
    ),
    keptScoped: true,
  });
});

test('a tag and an agent keep the nested section and the agent section', t => {
  t.deepEqual(
    filterAgentRules(NOTE, { tags: ['mobile'], agents: ['researcher'] }),
    {
      text: lines(
        ...UNSCOPED_HEAD,
        '## For tag: mobile, #android',
        '* m1',
        '### For agent: Researcher',
        '* m1-researcher',
        '## For agent: Researcher',
        '* r1',
        ...UNSCOPED_TAIL
      ),
      keptScoped: true,
    }
  );
});

test('a "For" heading in a code fence is plain text', t => {
  const note = lines(
    'intro',
    '```',
    '## For tag: mobile',
    '* fenced',
    '```',
    '~~~md',
    '## For agent: X',
    '~~~',
    'after'
  );
  t.deepEqual(filterAgentRules(note, {}), { text: note, keptScoped: false });
});

test('values are split on commas, trimmed, with empties ignored', t => {
  t.deepEqual(parseScopeHeading('For tags:  mobile ,  '), {
    kind: 'tag',
    values: ['mobile'],
  });
  t.deepEqual(parseScopeHeading('for Agents: #A, b'), {
    kind: 'agent',
    values: ['A', 'b'],
  });
  t.is(parseScopeHeading('Format for agents'), null);
  t.deepEqual(
    filterAgentRules(lines('## For tags:  mobile ,  ', '* m'), {
      tags: ['mobile'],
    }),
    { text: lines('## For tags:  mobile ,  ', '* m'), keptScoped: true }
  );
});

test('names match ignoring case, a leading #, and spaces/-/_', t => {
  t.is(normalizeScopeName(' Notes Graph '), 'notes-graph');
  t.is(normalizeScopeName('notes_graph'), 'notes-graph');
  t.is(normalizeScopeName('#Notes--graph'), 'notes-graph');
});

test('a note with nothing dropped is as written; dropped sections leave at most two blank lines', t => {
  const plain = '# Agent rules\n\n\n\n* keep my spacing';
  t.deepEqual(filterAgentRules(plain, {}), {
    text: plain,
    keptScoped: false,
  });
  const note = lines('a', '', '', '## For tag: x', '* x', '', '', '## B', 'b');
  t.is(filterAgentRules(note, {}).text, lines('a', '', '', '## B', 'b'));
});

test('a note that is all scoped and matches nothing is empty', t => {
  t.deepEqual(
    filterAgentRules('## For agent: Other\n* o', { agents: ['Me'] }),
    {
      text: '',
      keptScoped: false,
    }
  );
});

import { expect, test } from 'vitest';

import {
  filterAgentRules,
  normalizeScopeName,
  parseScopeHeading,
} from './scoped-rules';

/**
 * The scoped-rules spec's test cases. The server copy
 * (registry/__tests__/scoped-rules.spec.ts) and wf's Python have the same ones.
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

test('no context: only the unscoped text', () => {
  expect(filterAgentRules(NOTE, {})).toEqual({
    text: lines(...UNSCOPED_HEAD, ...UNSCOPED_TAIL),
    keptScoped: false,
  });
});

test('a project, matched however it is written, keeps its section and the headings in it', () => {
  expect(filterAgentRules(NOTE, { projects: ['Notes Graph'] })).toEqual({
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

test('a tag matches any of the values; a nested section needs its own match too', () => {
  expect(filterAgentRules(NOTE, { tags: ['Android'] })).toEqual({
    text: lines(
      ...UNSCOPED_HEAD,
      '## For tag: mobile, #android',
      '* m1',
      ...UNSCOPED_TAIL
    ),
    keptScoped: true,
  });
});

test('a tag and an agent keep the nested section and the agent section', () => {
  expect(
    filterAgentRules(NOTE, { tags: ['mobile'], agents: ['researcher'] })
  ).toEqual({
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
  });
});

test('a "For" heading in a code fence is plain text', () => {
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
  expect(filterAgentRules(note, {})).toEqual({ text: note, keptScoped: false });
});

test('values are split on commas, trimmed, with empties ignored', () => {
  expect(parseScopeHeading('For tags:  mobile ,  ')).toEqual({
    kind: 'tag',
    values: ['mobile'],
  });
  expect(parseScopeHeading('for Agents: #A, b')).toEqual({
    kind: 'agent',
    values: ['A', 'b'],
  });
  expect(parseScopeHeading('Format for agents')).toBe(null);
  expect(
    filterAgentRules(lines('## For tags:  mobile ,  ', '* m'), {
      tags: ['mobile'],
    })
  ).toEqual({
    text: lines('## For tags:  mobile ,  ', '* m'),
    keptScoped: true,
  });
});

test('names match ignoring case, a leading #, and spaces/-/_', () => {
  expect(normalizeScopeName(' Notes Graph ')).toBe('notes-graph');
  expect(normalizeScopeName('notes_graph')).toBe('notes-graph');
  expect(normalizeScopeName('#Notes--graph')).toBe('notes-graph');
});

test('a note with nothing dropped is as written; dropped sections leave at most two blank lines', () => {
  const plain = '# Agent rules\n\n\n\n* keep my spacing';
  expect(filterAgentRules(plain, {})).toEqual({
    text: plain,
    keptScoped: false,
  });
  const note = lines('a', '', '', '## For tag: x', '* x', '', '', '## B', 'b');
  expect(filterAgentRules(note, {}).text).toBe(lines('a', '', '', '## B', 'b'));
});

test('a note that is all scoped and matches nothing is empty', () => {
  expect(
    filterAgentRules('## For agent: Other\n* o', { agents: ['Me'] })
  ).toEqual({
    text: '',
    keptScoped: false,
  });
});

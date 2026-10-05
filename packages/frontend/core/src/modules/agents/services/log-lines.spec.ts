import { describe, expect, test } from 'vitest';

import { groupLogLines, parseLogLines, stampLines } from './log-lines';

const at = Date.parse('2026-10-03T12:00:00.000Z');

describe('log lines', () => {
  test('stamps every line start and reads the stamps back', () => {
    const log = stampLines('→ read_document\n\n  result\n', at);
    expect(parseLogLines(log)).toEqual([
      { number: 1, at, text: '→ read_document' },
      // An empty line has nothing to stamp.
      { number: 2, at: null, text: '' },
      { number: 3, at, text: '  result' },
    ]);
  });

  test('unstamped lines keep their text and have no time', () => {
    expect(parseLogLines('old log\n[not a stamp] x')).toEqual([
      { number: 1, at: null, text: 'old log' },
      { number: 2, at: null, text: '[not a stamp] x' },
    ]);
  });

  test('an empty log has no lines', () => {
    expect(parseLogLines('')).toEqual([]);
  });
});

describe('grouping tool lines', () => {
  const shape = (log: string) =>
    groupLogLines(parseLogLines(log)).map(segment =>
      segment.kind === 'line'
        ? segment.line.text
        : { tools: segment.tools, lines: segment.lines.length }
    );

  test('folds consecutive calls and results between the reasoning', () => {
    const log = [
      '▶ started · model x',
      'Let me look for the note.',
      '→ keyword_search  {"query":"Cosmo"}',
      '  ← [{"id":"a"}]',
      '→ read_document  {"docId":"a"}',
      '  ✗ Error: not found',
      'It is gone, so I will ask.',
      '✗ failed after 3 turns',
    ].join('\n');
    expect(shape(log)).toEqual([
      '▶ started · model x',
      'Let me look for the note.',
      { tools: ['keyword_search', 'read_document'], lines: 4 },
      'It is gone, so I will ask.',
      '✗ failed after 3 turns',
    ]);
  });

  test("folds a subagent's calls but keeps its reasoning", () => {
    const log = [
      '    ↳ Checking the repo.',
      '    ↳ → Grep  {"pattern":"x"}',
      '    ↳   ← 3 matches',
    ].join('\n');
    expect(shape(log)).toEqual([
      '    ↳ Checking the repo.',
      { tools: ['Grep'], lines: 2 },
    ]);
  });
});

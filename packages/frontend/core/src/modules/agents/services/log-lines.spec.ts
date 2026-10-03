import { describe, expect, test } from 'vitest';

import { parseLogLines, stampLines } from './log-lines';

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

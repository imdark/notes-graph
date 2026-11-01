import { describe, expect, test } from 'vitest';

import { keyToInput, TerminalScreen } from './terminal-screen';

const text = (s: TerminalScreen) =>
  s
    .spans()
    .map(r => r.map(x => x.text).join(''))
    .join('\n');

describe('TerminalScreen', () => {
  test('lines and carriage returns', () => {
    const s = new TerminalScreen();
    s.write('hello\r\nworld');
    expect(text(s)).toBe('hello\nworld');
    s.write('\rWO');
    expect(text(s)).toBe('hello\nWOrld');
  });

  test('colours become styled runs', () => {
    const s = new TerminalScreen();
    s.write('a\x1b[31mb\x1b[0mc');
    const [row] = s.spans();
    expect(row.map(x => x.text)).toEqual(['a', 'b', 'c']);
    expect(row[1].fg).toBeDefined();
    expect(row[2].fg).toBeUndefined();
  });

  test('a redrawn status line replaces itself', () => {
    const s = new TerminalScreen();
    s.write('thinking.\r\n');
    s.write('\x1b[1A\x1b[2Kthinking..\r\n');
    expect(text(s)).toBe('thinking..\n');
  });

  test('a sequence split across writes is held', () => {
    const s = new TerminalScreen();
    s.write('x\x1b[3');
    s.write('1my');
    expect(text(s)).toBe('xy');
    expect(s.spans()[0][1].fg).toBeDefined();
  });

  test('titles and unknown modes are dropped', () => {
    const s = new TerminalScreen();
    s.write('\x1b]0;title\x07\x1b[?25lok');
    expect(text(s)).toBe('ok');
  });

  test('erase to end of line', () => {
    const s = new TerminalScreen();
    s.write('abcdef\r\x1b[3C\x1b[K');
    expect(text(s)).toBe('abc');
  });
});

describe('keyToInput', () => {
  const key = (k: string, o: object = {}) =>
    keyToInput({
      key: k,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      ...o,
    });
  test('maps keys to bytes', () => {
    expect(key('a')).toBe('a');
    expect(key('Enter')).toBe('\r');
    expect(key('ArrowUp')).toBe('\x1b[A');
    expect(key('c', { ctrlKey: true })).toBe('\x03');
    expect(key('Shift')).toBeNull();
    expect(key('v', { metaKey: true })).toBeNull();
  });
});

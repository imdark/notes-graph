import test from 'ava';

import {
  parseHarness,
  parseResume,
  SCROLLBACK_LIMIT,
  TerminalSessionService,
} from '../terminal-sessions';

const open = (s: TerminalSessionService, workspaceId = 'w') =>
  s.open({ workspaceId, deviceKey: 'box', userId: 'u', harness: 'claude' });

test('harness is one of the known ones', t => {
  t.is(parseHarness('codex'), 'codex');
  t.throws(() => parseHarness('rm -rf'));
});

test('resume ids stay shell-safe', t => {
  t.is(parseResume(undefined), null);
  t.is(parseResume('abc-123_x.y'), 'abc-123_x.y');
  t.throws(() => parseResume('a; b'));
});

test('a session starts waiting and runs on first output', t => {
  const s = new TerminalSessionService();
  const session = open(s);
  t.is(session.status, 'starting');
  t.is(s.pending('w', 'box').length, 1);
  s.append('w', session.id, 'hi');
  t.is(s.get('w', session.id)?.status, 'running');
  t.is(s.pending('w', 'box').length, 0);
});

test('a viewer that comes back gets only what it missed', t => {
  const s = new TerminalSessionService();
  const { id } = open(s);
  s.append('w', id, 'hello ');
  s.append('w', id, 'world');
  t.is(s.snapshot('w', id)?.data, 'hello world');
  const rest = s.snapshot('w', id, 6);
  t.is(rest?.data, 'world');
  t.is(rest?.from, 6);
});

test('scrollback is capped and offsets stay absolute', t => {
  const s = new TerminalSessionService();
  const { id } = open(s);
  s.append('w', id, 'a'.repeat(SCROLLBACK_LIMIT));
  s.append('w', id, 'bcd');
  const snap = s.snapshot('w', id, 0);
  t.is(snap?.data.length, SCROLLBACK_LIMIT);
  t.is(snap?.from, 3);
  t.true(snap?.data.endsWith('bcd'));
  t.is(snap?.session.length, SCROLLBACK_LIMIT + 3);
});

test('sessions are scoped to their workspace', t => {
  const s = new TerminalSessionService();
  const { id } = open(s);
  t.is(s.get('other', id), null);
  t.is(s.append('other', id, 'x'), null);
  t.false(s.remove('other', id));
});

test('exit records the code; size is clamped', t => {
  const s = new TerminalSessionService();
  const { id } = open(s);
  t.is(s.exit('w', id, 3)?.exitCode, 3);
  t.is(s.markRunning('w', id), null);
  const r = s.resize('w', id, 99999, 40);
  t.is(r?.cols, 120);
  t.is(r?.rows, 40);
});

test('a device holds a limited number of live sessions', t => {
  const s = new TerminalSessionService();
  for (let i = 0; i < 8; i++) open(s);
  t.throws(() => open(s));
});

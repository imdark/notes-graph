import test from 'ava';

import {
  isSessionLimit,
  parseSessionReset,
  SESSION_LIMIT_RETRY_MS,
  sessionLimitRunAfter,
} from '../session-limit';

// 2026-10-05 12:00 in Los Angeles (PDT, UTC-7).
const now = Date.parse('2026-10-05T19:00:00Z');

test('recognises every wording of the limit message', t => {
  for (const text of [
    'Claude AI usage limit reached|1759600800',
    'Claude usage limit reached. Your limit will reset at 7pm (Asia/Jerusalem).',
    "You've hit your limit · resets 3pm (America/Los_Angeles)",
    '5-hour limit reached ∙ resets 3:30pm',
    'Weekly limit reached ∙ resets Oct 9, 5pm (Europe/London)',
  ]) {
    t.true(isSessionLimit(text), text);
  }
});

test('leaves other failures alone', t => {
  for (const text of [
    'error_max_turns',
    'the run ended without writing a result',
    "'claude' is not on PATH on this device",
    null,
  ]) {
    t.false(isSessionLimit(text), String(text));
  }
});

test('reads an epoch reset', t => {
  t.is(parseSessionReset('Claude AI usage limit reached|1759600800', now), 1759600800_000);
});

test('reads a clock time in the zone given', t => {
  t.is(
    parseSessionReset("You've hit your limit · resets 3pm (America/Los_Angeles)", now),
    Date.parse('2026-10-05T22:00:00Z')
  );
  t.is(
    parseSessionReset('Your limit will reset at 7:30pm (Asia/Jerusalem).', now),
    // 19:30 IDT (UTC+3) is 16:30Z, already past today, so tomorrow's.
    Date.parse('2026-10-06T16:30:00Z')
  );
});

test('a time already past today is tomorrow', t => {
  t.is(
    parseSessionReset('resets 9am (America/Los_Angeles)', now),
    Date.parse('2026-10-06T16:00:00Z')
  );
});

test('reads a dated reset', t => {
  t.is(
    parseSessionReset('Weekly limit reached ∙ resets Oct 9, 5pm (Europe/London)', now),
    Date.parse('2026-10-09T16:00:00Z')
  );
});

test('a clock time with no zone cannot be placed', t => {
  t.is(parseSessionReset('5-hour limit reached ∙ resets 3:30pm', now), null);
  t.is(
    sessionLimitRunAfter('5-hour limit reached ∙ resets 3:30pm', now).getTime(),
    now + SESSION_LIMIT_RETRY_MS
  );
});

test('runs a minute after the reset', t => {
  t.is(
    sessionLimitRunAfter('resets 3pm (America/Los_Angeles)', now).getTime(),
    Date.parse('2026-10-05T22:01:00Z')
  );
});

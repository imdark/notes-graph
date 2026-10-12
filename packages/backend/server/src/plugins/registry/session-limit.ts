/**
 * Recognising a run that stopped because the device's Claude account hit its
 * session (usage) limit, and when that limit resets.
 *
 * Claude Code ends such a run with a one-line message instead of an answer,
 * and the device reports it as the job's error. Its wording has changed over
 * releases, so every form seen so far is accepted:
 *
 *   Claude AI usage limit reached|1759600800
 *   Claude usage limit reached. Your limit will reset at 7pm (Asia/Jerusalem).
 *   You've hit your limit · resets 3pm (America/Los_Angeles)
 *   5-hour limit reached ∙ resets 3:30pm
 *   Weekly limit reached ∙ resets Oct 9, 5pm (Europe/London)
 */

/** When the message gives no reset time we can pin down, look again after this. */
export const SESSION_LIMIT_RETRY_MS = 30 * 60 * 1000;
/** Run a little after the reset, not on the second it is due. */
const AFTER_RESET_MS = 60 * 1000;
/** Weekly limits are the longest; anything past this is a misread. */
const MAX_WAIT_MS = 8 * 24 * 60 * 60 * 1000;

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

/** Whether this error (or a too-short "result") is Claude's limit message. */
export function isSessionLimit(text: string | null | undefined): boolean {
  if (!text || text.length > 2000) return false;
  return (
    /usage limit reached/i.test(text) ||
    (/\blimit\b/i.test(text) && /\bresets?\b/i.test(text))
  );
}

/** How far `timeZone` is ahead of UTC at `at`, in ms. Throws on a bad zone. */
function zoneOffset(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(at));
  const get = (type: string) =>
    Number(parts.find(part => part.type === type)?.value ?? 0);
  const wall = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour'), get('minute'), get('second')
  );
  return wall - Math.floor(at / 1000) * 1000;
}

/** The wall-clock fields' calendar date in `timeZone` at `at`. */
function zoneDate(at: number, timeZone: string) {
  const local = new Date(at + zoneOffset(at, timeZone));
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
  };
}

/** A wall-clock time in `timeZone` as an instant. */
function fromZone(
  year: number, month: number, day: number,
  hour: number, minute: number, timeZone: string
): number {
  const guess = Date.UTC(year, month, day, hour, minute);
  // Twice, so a guess on the far side of a DST change settles.
  const first = guess - zoneOffset(guess, timeZone);
  return guess - zoneOffset(first, timeZone);
}

/**
 * When the limit in `text` resets, as epoch ms, or null if it gives no time
 * that can be placed: a clock time with no zone could be hours either way,
 * since the zone is the device's and not the server's.
 */
export function parseSessionReset(text: string, now = Date.now()): number | null {
  const epoch = /limit reached\|(\d{9,13})/i.exec(text);
  if (epoch) {
    const value = Number(epoch[1]);
    return value < 1e12 ? value * 1000 : value;
  }

  const clock =
    /resets?\b(?:\s+at)?\s+(?:([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b(?:[^(\n]*\(([^)]+)\))?/i.exec(
      text
    );
  if (!clock) return null;
  const [, monthName, dayText, hourText, minuteText, meridiem, zone] = clock;
  if (!zone) return null;
  const timeZone = zone.trim();

  let hour = Number(hourText) % 12;
  if (meridiem.toLowerCase() === 'pm') hour += 12;
  const minute = minuteText ? Number(minuteText) : 0;

  try {
    const today = zoneDate(now, timeZone);
    const month = monthName
      ? MONTHS.indexOf(monthName.slice(0, 3).toLowerCase())
      : -1;
    if (monthName && month >= 0 && dayText) {
      let at = fromZone(today.year, month, Number(dayText), hour, minute, timeZone);
      // "Jan 2" read on Dec 30 is next year's.
      if (at < now - 24 * 60 * 60 * 1000) {
        at = fromZone(today.year + 1, month, Number(dayText), hour, minute, timeZone);
      }
      return at;
    }
    let at = fromZone(today.year, today.month, today.day, hour, minute, timeZone);
    // A time already past today is tomorrow's.
    if (at <= now) {
      at = fromZone(today.year, today.month, today.day + 1, hour, minute, timeZone);
    }
    return at;
  } catch {
    // Not a time zone Intl knows.
    return null;
  }
}

/**
 * When a job stopped by the limit in `text` should be handed out again:
 * just after the reset, or after a retry interval if the reset can't be read.
 */
export function sessionLimitRunAfter(text: string, now = Date.now()): Date {
  const reset = parseSessionReset(text, now);
  const at =
    reset === null || reset <= now || reset - now > MAX_WAIT_MS
      ? now + SESSION_LIMIT_RETRY_MS
      : reset + AFTER_RESET_MS;
  return new Date(at);
}

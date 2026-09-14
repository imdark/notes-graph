/**
 * Pure recurrence model for scheduled/repeating notes & blocks. Dates are plain
 * local calendar dates encoded as `YYYY-MM-DD` strings (no timezone math), which
 * compare correctly with `<`/`>` and avoid UTC drift.
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday … 6 = Saturday

export type RecurrenceRule =
  | { freq: 'daily' }
  | { freq: 'weekly'; weekdays: Weekday[] }
  | { freq: 'monthly'; day: number }; // day-of-month, 1–31

export interface ScheduleRule {
  /** anchor / first date the recurrence is active from, `YYYY-MM-DD` */
  start: string;
  /** optional last date (inclusive), `YYYY-MM-DD` */
  until?: string;
  rule: RecurrenceRule;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE.test(value);
}

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromISODate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(value: string, amount: number): string {
  const date = fromISODate(value);
  date.setDate(date.getDate() + amount);
  return toISODate(date);
}

export function weekdayOf(value: string): Weekday {
  return fromISODate(value).getDay() as Weekday;
}

export function todayISO(): string {
  return toISODate(new Date());
}

/** Whether a rule produces an occurrence on the given date. */
export function ruleMatchesDate(schedule: ScheduleRule, date: string): boolean {
  if (date < schedule.start) return false;
  if (schedule.until && date > schedule.until) return false;
  const rule = schedule.rule;
  switch (rule.freq) {
    case 'daily':
      return true;
    case 'weekly':
      return rule.weekdays.includes(weekdayOf(date));
    case 'monthly':
      return fromISODate(date).getDate() === rule.day;
    default:
      return false;
  }
}

/**
 * All occurrence dates of a rule within `[rangeStart, rangeEnd]` (inclusive).
 * Iterates day-by-day, which is plenty fast for the bounded ranges the schedule
 * UI requests (weeks/months), and is guarded against runaway loops.
 */
export function expandOccurrences(
  schedule: ScheduleRule,
  rangeStart: string,
  rangeEnd: string
): string[] {
  const result: string[] = [];
  let cursor = rangeStart < schedule.start ? schedule.start : rangeStart;
  const end =
    schedule.until && schedule.until < rangeEnd ? schedule.until : rangeEnd;
  let guard = 0;
  while (cursor <= end && guard++ < 3660) {
    if (ruleMatchesDate(schedule, cursor)) {
      result.push(cursor);
    }
    cursor = addDays(cursor, 1);
  }
  return result;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ordinal = (n: number) => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

/** "9:00 AM" from "09:00"; '' for empty/invalid. */
export function formatTime(time?: string): string {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return '';
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${`${m}`.padStart(2, '0')} ${period}`;
}

/** "9:00 AM – 10:00 AM" / "9:00 AM" / "". */
export function formatTimeRange(time?: string, endTime?: string): string {
  const start = formatTime(time);
  if (!start) return '';
  const end = formatTime(endTime);
  return end ? `${start} – ${end}` : start;
}

/** Human-readable label, e.g. "Every Mon", "Every day", "Monthly on the 1st". */
export function describeRule(schedule: ScheduleRule): string {
  const rule = schedule.rule;
  switch (rule.freq) {
    case 'daily':
      return 'Every day';
    case 'weekly': {
      if (rule.weekdays.length === 0) return 'Weekly';
      if (rule.weekdays.length === 7) return 'Every day';
      const days = [...rule.weekdays]
        .sort((a, b) => a - b)
        .map(w => WEEKDAY_SHORT[w])
        .join(', ');
      return `Every ${days}`;
    }
    case 'monthly':
      return `Monthly on the ${ordinal(rule.day)}`;
    default:
      return 'Repeats';
  }
}

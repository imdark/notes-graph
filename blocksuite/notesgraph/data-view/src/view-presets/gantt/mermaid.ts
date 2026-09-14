/**
 * Minimal parser for Mermaid `gantt` definitions, resolving each task to an
 * inclusive [start, end] day range (local-midnight timestamps) plus its
 * `after` dependencies. Supports `section`, `dateFormat` (YYYY-MM-DD), `excludes`
 * (weekday names / `weekends` / ISO dates), task tags (crit/active/done/…),
 * date or `after <id>…` starts, and `<n>d|w|h` durations. Durations and starts
 * skip excluded days so "6-day week" charts line up.
 */

const DAY = 24 * 60 * 60 * 1000;

const TASK_TAGS = new Set(['active', 'done', 'crit', 'milestone', 'vert']);

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export interface MermaidGanttTask {
  /** Mermaid task id (explicit, or generated for unnamed tasks). */
  id: string;
  name: string;
  /** Free-text details from `%% <id>: …` comment lines (Mermaid-safe). */
  description?: string;
  section?: string;
  /** Inclusive first day (local midnight ms). */
  start: number;
  /** Inclusive last day (local midnight ms). */
  end: number;
  /** Mermaid ids of predecessors, from `after …`. */
  deps: string[];
  crit: boolean;
  /** A zero-duration point marker (the `milestone` task tag). */
  milestone: boolean;
}

export interface MermaidGantt {
  title?: string;
  tasks: MermaidGanttTask[];
  /** Weekday indices (0=Sun…6=Sat) from `excludes`, e.g. `[0]` for a 6-day week. */
  offWeekdays: number[];
}

interface RawTask {
  id: string;
  name: string;
  section?: string;
  crit: boolean;
  milestone: boolean;
  /** Explicit start date (ms) if given as a date, else undefined. */
  startDate?: number;
  deps: string[];
  endSpec: string;
  order: number;
}

interface Excludes {
  weekdays: Set<number>;
  dates: Set<string>;
}

const startOfDay = (ts: number) => {
  const date = new Date(ts);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
};

const dateKey = (ts: number) => {
  const date = new Date(ts);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const parseDate = (str: string): number | undefined => {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(str.trim());
  if (!match) return undefined;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
};

const parseDuration = (str: string): number | undefined => {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i.exec(str.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  switch ((match[2] ?? '').toLowerCase()) {
    case 'w':
      return Math.max(1, Math.round(value * 7));
    case 'd':
      return Math.max(1, Math.round(value));
    case 'h':
      return Math.max(1, Math.round(value / 24));
    default:
      // minutes / seconds / ms — anything sub-day rounds up to a single day.
      return 1;
  }
};

const isExcluded = (ts: number, excludes: Excludes) =>
  excludes.weekdays.has(new Date(ts).getDay()) ||
  excludes.dates.has(dateKey(ts));

/** Move forward to the next non-excluded day (returns `ts` if already valid). */
const skipExcluded = (ts: number, excludes: Excludes) => {
  let date = ts;
  while (isExcluded(date, excludes)) date += DAY;
  return date;
};

/** Inclusive end day for `days` working days starting at (valid) `start`. */
const addWorkingDays = (start: number, days: number, excludes: Excludes) => {
  let date = start;
  let counted = 1;
  while (counted < days) {
    date += DAY;
    if (!isExcluded(date, excludes)) counted++;
  }
  return date;
};

const parseExcludes = (value: string, excludes: Excludes) => {
  for (const token of value.split(/[,\s]+/).filter(Boolean)) {
    const lower = token.toLowerCase();
    if (lower === 'weekends') {
      excludes.weekdays.add(0);
      excludes.weekdays.add(6);
    } else if (lower in WEEKDAYS) {
      excludes.weekdays.add(WEEKDAYS[lower] as number);
    } else {
      const date = parseDate(token);
      if (date !== undefined) excludes.dates.add(dateKey(date));
    }
  }
};

export const parseMermaidGantt = (text: string): MermaidGantt => {
  const excludes: Excludes = { weekdays: new Set(), dates: new Set() };
  const raws: RawTask[] = [];
  /** taskId → detail lines, from `%% <id>: …` comments. */
  const notes = new Map<string, string[]>();
  let title: string | undefined;
  let section: string | undefined;
  let order = 0;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('%%')) {
      // `%% <id>: text` (or `%% note <id>: text`) attaches details to a task,
      // while staying a valid Mermaid comment that renderers ignore.
      const note = /^%%\s*(?:note\s+)?([A-Za-z0-9_-]+)\s*:\s*(.+)$/i.exec(line);
      const noteId = note?.[1];
      const noteText = note?.[2];
      if (noteId && noteText) {
        const list = notes.get(noteId) ?? [];
        list.push(noteText.trim());
        notes.set(noteId, list);
      }
      continue;
    }

    const lower = line.toLowerCase();
    if (lower === 'gantt') continue;
    if (lower.startsWith('title ')) {
      title = line.slice(6).trim();
      continue;
    }
    if (lower.startsWith('section ')) {
      section = line.slice(8).trim();
      continue;
    }
    if (lower.startsWith('excludes ')) {
      parseExcludes(line.slice(9), excludes);
      continue;
    }
    if (
      lower.startsWith('dateformat') ||
      lower.startsWith('axisformat') ||
      lower.startsWith('includes') ||
      lower.startsWith('todaymarker') ||
      lower.startsWith('tickinterval') ||
      lower.startsWith('weekday')
    ) {
      continue;
    }

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim();
    const parts = line
      .slice(colon + 1)
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);

    let crit = false;
    let milestone = false;
    while (parts.length > 0) {
      const head = (parts[0] ?? '').toLowerCase();
      if (!TASK_TAGS.has(head)) break;
      if (head === 'crit') crit = true;
      if (head === 'milestone') milestone = true;
      parts.shift();
    }

    let id: string | undefined;
    let startSpec: string | undefined;
    let endSpec = '';
    if (parts.length >= 3) {
      id = parts[0];
      startSpec = parts[1];
      endSpec = parts[2] ?? '';
    } else if (parts.length === 2) {
      startSpec = parts[0];
      endSpec = parts[1] ?? '';
    } else if (parts.length === 1) {
      endSpec = parts[0] ?? '';
    }

    const deps: string[] = [];
    let startDate: number | undefined;
    if (startSpec) {
      const after = /^after\s+(.+)$/i.exec(startSpec);
      if (after) {
        deps.push(...(after[1] ?? '').split(/\s+/).filter(Boolean));
      } else {
        startDate = parseDate(startSpec);
      }
    }

    raws.push({
      id: id ?? `__task_${order}`,
      name,
      section,
      crit,
      milestone,
      startDate,
      deps,
      endSpec,
      order,
    });
    order++;
  }

  const resolved = new Map<string, { start: number; end: number }>();

  const computeEnd = (start: number, endSpec: string) => {
    const date = parseDate(endSpec);
    if (date !== undefined) return Math.max(startOfDay(date), start);
    const days = parseDuration(endSpec) ?? 1;
    return addWorkingDays(start, days, excludes);
  };

  // Iteratively resolve: date starts immediately, `after`/implicit-chain starts
  // once their predecessors are known.
  for (let pass = 0; pass <= raws.length; pass++) {
    let progress = false;
    for (const raw of raws) {
      if (resolved.has(raw.id)) continue;

      let start: number | undefined;
      if (raw.startDate !== undefined) {
        start = raw.startDate;
      } else if (raw.deps.length) {
        const ends = raw.deps.map(dep => resolved.get(dep)?.end);
        if (ends.every((end): end is number => end !== undefined)) {
          start = Math.max(...ends) + DAY;
        }
      } else if (raw.order === 0) {
        start = Date.now();
      } else {
        const prev = raws[raw.order - 1];
        const prevEnd = prev ? resolved.get(prev.id)?.end : undefined;
        if (prevEnd !== undefined) start = prevEnd + DAY;
      }

      if (start === undefined) continue;
      start = skipExcluded(startOfDay(start), excludes);
      resolved.set(raw.id, { start, end: computeEnd(start, raw.endSpec) });
      progress = true;
    }
    if (!progress) break;
  }

  const tasks: MermaidGanttTask[] = raws.map(raw => {
    const range = resolved.get(raw.id) ?? {
      start: skipExcluded(startOfDay(Date.now()), excludes),
      end: skipExcluded(startOfDay(Date.now()), excludes),
    };
    return {
      id: raw.id,
      name: raw.name,
      description: notes.get(raw.id)?.join('\n'),
      section: raw.section,
      start: range.start,
      // A milestone collapses to a single point at its start day.
      end: raw.milestone ? range.start : range.end,
      deps: raw.deps,
      crit: raw.crit,
      milestone: raw.milestone,
    };
  });

  return {
    title,
    tasks,
    offWeekdays: [...excludes.weekdays].sort((a, b) => a - b),
  };
};

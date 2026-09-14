/**
 * Org-mode planning/log timestamps carried at the end of a list item's
 * text, e.g. `SCHEDULED: <2026-07-20 Mon>` or `CLOSED: [2026-07-17 Fri 14:30]`.
 *
 * Keyword semantics follow org-mode where it has them:
 * - `SCHEDULED` — planned start (active timestamp `<…>`; marks the item as
 *   a scheduled task)
 * - `DEADLINE`  — planned end (active timestamp)
 * - `CLOSED`    — actual completion (inactive timestamp `[…]`)
 * - `STARTED`   — actual start; org has no standard keyword for this, so a
 *   custom log keyword with an inactive timestamp is used
 * - `CREATED`   — creation time (custom log keyword, inactive)
 */

export const ORG_PLANNING_KEYWORDS = [
  'SCHEDULED',
  'DEADLINE',
  'CLOSED',
  'STARTED',
  'CREATED',
] as const;

export type OrgPlanningKeyword = (typeof ORG_PLANNING_KEYWORDS)[number];

/** Active timestamps (`<…>`) plan the future; inactive (`[…]`) log the past. */
const ACTIVE_KEYWORDS: ReadonlySet<OrgPlanningKeyword> = new Set([
  'SCHEDULED',
  'DEADLINE',
]);

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Formats an org timestamp annotation. The time of day is included unless
 * the date sits exactly on local midnight (date-only values from date
 * pickers), matching org's own date vs date-time forms.
 */
export function formatOrgTimestamp(
  keyword: OrgPlanningKeyword,
  epochMs: number
): string {
  const d = new Date(epochMs);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${DOW[d.getDay()]}`;
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  const stamp = hasTime
    ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : date;
  const [open, close] = ACTIVE_KEYWORDS.has(keyword) ? '<>' : '[]';
  return `${keyword}: ${open}${stamp}${close}`;
}

const ORG_TIMESTAMP_RE =
  /(SCHEDULED|DEADLINE|CLOSED|STARTED|CREATED):\s*[[<](\d{4})-(\d{2})-(\d{2})(?:\s+[A-Za-z]{2,3})?(?:\s+(\d{1,2}):(\d{2}))?[\]>]/;

/** Parses a single org timestamp annotation (as stored in the attribute). */
export function parseOrgTimestamp(
  annotation: string
): { keyword: OrgPlanningKeyword; epochMs: number } | null {
  const m = ORG_TIMESTAMP_RE.exec(annotation);
  if (!m) return null;
  const [, keyword, y, mo, d, h, mi] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    h ? Number(h) : 0,
    mi ? Number(mi) : 0
  );
  return { keyword: keyword as OrgPlanningKeyword, epochMs: +date };
}

/**
 * Finds every org timestamp annotation in raw text (for annotations typed
 * by hand rather than written as chips).
 */
export function findOrgTimestamps(
  text: string
): { keyword: OrgPlanningKeyword; epochMs: number; index: number; length: number }[] {
  const re = new RegExp(ORG_TIMESTAMP_RE.source, 'g');
  const results = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const parsed = parseOrgTimestamp(m[0]);
    if (parsed) {
      results.push({ ...parsed, index: m.index, length: m[0].length });
    }
  }
  return results;
}

/**
 * The minimal Y.Text surface the timestamp read/write helpers need — both
 * `Y.Text` itself and anything exposing the same API qualify.
 */
export interface OrgYText {
  length: number;
  toString(): string;
  toDelta(): { insert?: unknown; attributes?: Record<string, unknown> }[];
  delete(index: number, length: number): void;
  insert(index: number, content: string, attributes?: object): void;
  format(index: number, length: number, attributes: object): void;
}

/**
 * Finds a keyword's timestamp in a text — as a chip embed (a character
 * carrying the `orgTimestamp` attribute) or a raw typed annotation.
 */
export function findOrgTimestampIn(
  yText: OrgYText,
  keyword: OrgPlanningKeyword
): { epochMs: number; index: number; length: number; embedded: boolean } | null {
  let offset = 0;
  for (const op of yText.toDelta()) {
    const insert = typeof op.insert === 'string' ? op.insert : '';
    const annotation = op.attributes?.orgTimestamp;
    if (typeof annotation === 'string') {
      const parsed = parseOrgTimestamp(annotation);
      if (parsed?.keyword === keyword) {
        return {
          epochMs: parsed.epochMs,
          index: offset,
          length: insert.length,
          embedded: true,
        };
      }
    }
    offset += insert.length;
  }
  const raw = findOrgTimestamps(yText.toString()).find(
    v => v.keyword === keyword
  );
  return raw ? { ...raw, embedded: false } : null;
}

/** Every stamp for a keyword — chips and raw — in document order. */
function collectOrgTimestampsIn(
  yText: OrgYText,
  keyword: OrgPlanningKeyword
): { index: number; length: number; epochMs: number }[] {
  const found: { index: number; length: number; epochMs: number }[] = [];
  let offset = 0;
  for (const op of yText.toDelta()) {
    const insert = typeof op.insert === 'string' ? op.insert : '';
    const annotation = op.attributes?.orgTimestamp;
    if (typeof annotation === 'string') {
      const parsed = parseOrgTimestamp(annotation);
      if (parsed?.keyword === keyword) {
        found.push({
          index: offset,
          length: insert.length,
          epochMs: parsed.epochMs,
        });
      }
    }
    offset += insert.length;
  }
  for (const raw of findOrgTimestamps(yText.toString())) {
    if (raw.keyword === keyword) {
      found.push({
        index: raw.index,
        length: raw.length,
        epochMs: raw.epochMs,
      });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * Removes duplicate stamps for a keyword, keeping only the EARLIEST one —
 * a task restarted several times must show a single (original) start time.
 * Historical writers could double-stamp: the old MCP raw-text writer
 * couldn't see chip stamps, so a chip + raw pair could accumulate.
 */
export function dedupeOrgTimestampsIn(
  yText: OrgYText,
  keyword: OrgPlanningKeyword
): void {
  for (;;) {
    const all = collectOrgTimestampsIn(yText, keyword);
    if (all.length <= 1) return;
    const earliest = all.reduce(
      (min, v) => (v.epochMs < min.epochMs ? v : min),
      all[0]
    );
    const victim = [...all].reverse().find(v => v !== earliest);
    if (!victim) return;
    let { index, length } = victim;
    if (index > 0 && yText.toString()[index - 1] === ' ') {
      index--;
      length++;
    }
    yText.delete(index, length);
  }
}

/**
 * Sets, updates or (with `epochMs: null`) removes a keyword's timestamp.
 * New annotations are appended at the end of the line as chip embeds; raw
 * typed annotations are converted to chips when updated.
 */
export function setOrgTimestampIn(
  yText: OrgYText,
  keyword: OrgPlanningKeyword,
  epochMs: number | null
): void {
  dedupeOrgTimestampsIn(yText, keyword);
  const existing = findOrgTimestampIn(yText, keyword);

  if (epochMs == null) {
    if (!existing) return;
    let { index, length } = existing;
    if (index > 0 && yText.toString()[index - 1] === ' ') {
      index--;
      length++;
    }
    yText.delete(index, length);
    return;
  }

  const annotation = formatOrgTimestamp(keyword, epochMs);
  if (existing?.embedded) {
    yText.format(existing.index, existing.length, {
      orgTimestamp: annotation,
    });
  } else if (existing) {
    yText.delete(existing.index, existing.length);
    yText.insert(existing.index, ' ', { orgTimestamp: annotation });
  } else {
    const end = yText.length;
    // The separator must explicitly negate the attribute — Yjs inserts
    // inherit the preceding character's formatting, so an unattributed
    // space appended right after another badge would become a badge too.
    yText.insert(end, ' ', { orgTimestamp: null });
    yText.insert(end + 1, ' ', { orgTimestamp: annotation });
  }
}

/**
 * Applies org status-change logging to a text: entering Done stamps
 * CLOSED, leaving it removes CLOSED, and the first move into any other
 * active status stamps STARTED. `now` is injected by the caller.
 */
export function applyOrgStatusTimestamps(
  yText: OrgYText,
  statusLabel: string,
  now: number,
  /**
   * Explicit lane role. When omitted the label heuristics apply
   * ('Done' → done, 'Todo' → start, anything else → progress).
   */
  role?: 'start' | 'progress' | 'blocked' | 'done'
): void {
  const effective =
    role ??
    (statusLabel === 'Done'
      ? 'done'
      : statusLabel === 'Todo'
        ? 'start'
        : 'progress');
  if (effective === 'done') {
    if (!findOrgTimestampIn(yText, 'CLOSED')) {
      setOrgTimestampIn(yText, 'CLOSED', now);
    }
  } else {
    setOrgTimestampIn(yText, 'CLOSED', null);
    if (effective !== 'start' && !findOrgTimestampIn(yText, 'STARTED')) {
      setOrgTimestampIn(yText, 'STARTED', now);
    }
  }
}

/**
 * Trailing org planning stamps (the CLOSED/STARTED/… chips) annotate the whole
 * list item, so a split must keep them on the original block. Given the delta
 * of a line and the caret's split index, returns the index to actually split
 * at: when the caret sits at or past the item's real text — i.e. only
 * whitespace and org-stamp chips follow — it returns the line's true end, so
 * the stamps stay put and the new block starts blank. Otherwise the caret
 * index is returned unchanged (a genuine mid-text split still divides the line).
 */
export function orgStampAwareSplitIndex(
  delta: { insert?: unknown; attributes?: Record<string, unknown> }[],
  inlineIndex: number
): number {
  let offset = 0;
  let logicalEnd = 0; // index just past the last non-stamp, non-space character
  let lastStampEnd = 0; // index just past the last org-stamp chip
  for (const op of delta) {
    const insert = typeof op.insert === 'string' ? op.insert : '';
    const isStamp =
      typeof op.attributes?.orgTimestamp === 'string' ||
      typeof op.attributes?.orgStatus === 'string';
    if (isStamp) {
      lastStampEnd = offset + insert.length;
    } else {
      for (let i = 0; i < insert.length; i++) {
        if (insert[i] !== ' ') logicalEnd = offset + i + 1;
      }
    }
    offset += insert.length;
  }
  // Only redirect the split when the caret is past all real content AND a stamp
  // trails it — otherwise leave normal splitting untouched.
  if (inlineIndex >= logicalEnd && lastStampEnd > logicalEnd) {
    return offset;
  }
  return inlineIndex;
}

/**
 * Which org planning keyword a database date column represents, by its
 * (case-insensitive) name — the same convention the status column uses.
 */
export function orgKeywordForDateColumn(
  name: string
): OrgPlanningKeyword | null {
  switch (name.trim().toLowerCase()) {
    case 'scheduled':
    case 'planned start':
    case 'plan start':
    case 'start date':
      return 'SCHEDULED';
    case 'deadline':
    case 'due':
    case 'due date':
    case 'planned end':
    case 'plan end':
    case 'end date':
      return 'DEADLINE';
    case 'started':
    case 'start time':
      return 'STARTED';
    case 'closed':
    case 'completed':
    case 'end time':
      return 'CLOSED';
    case 'created':
    case 'created at':
    case 'create time':
      return 'CREATED';
    default:
      return null;
  }
}

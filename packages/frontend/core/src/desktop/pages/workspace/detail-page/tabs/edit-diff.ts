/**
 * Side-by-side diff for an agent's file-edit permission prompt.
 *
 * Claude Code asks before its Edit / MultiEdit / Write tools; the prompt's
 * `detail` is the tool input as JSON. This turns that into rows of
 * before/after lines, with the changed words inside a changed line marked —
 * enough to read an edit at a glance instead of decoding escaped JSON.
 */

/** A run of text inside one line; `changed` marks the words that differ. */
export interface DiffSpan {
  text: string;
  changed: boolean;
}

/** One row of the side-by-side view. A missing side is a blank gutter. */
export interface DiffRow {
  kind: 'same' | 'changed' | 'removed' | 'added';
  left: DiffSpan[] | null;
  right: DiffSpan[] | null;
}

export interface FileEdit {
  path: string;
  /** null for a new file written from scratch. */
  before: string | null;
  after: string;
}

export interface EditPreview {
  tool: string;
  edits: FileEdit[];
}

// Past this many cells the LCS table costs more than a prompt is worth; such
// edits fall back to "everything before removed, everything after added".
const MAX_CELLS = 400_000;

type Op<T> = { op: 'same' | 'del' | 'ins'; a?: T; b?: T };

/** Longest-common-subsequence edit script between two sequences. */
function diffSeq<T>(a: T[], b: T[]): Op<T>[] {
  // Trim the shared head and tail first: most edits touch a few lines of a
  // long block, and it keeps the table small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const head: Op<T>[] = a
    .slice(0, start)
    .map(x => ({ op: 'same', a: x, b: x }));
  const tail: Op<T>[] = a
    .slice(endA)
    .map((x, i) => ({ op: 'same', a: x, b: b[endB + i] }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  const mid: Op<T>[] = [];
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    for (const x of midA) mid.push({ op: 'del', a: x });
    for (const y of midB) mid.push({ op: 'ins', b: y });
    return [...head, ...mid, ...tail];
  }

  // lcs[i][j] = LCS length of midA[i..] and midB[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        midA[i] === midB[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      mid.push({ op: 'same', a: midA[i], b: midB[j] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      mid.push({ op: 'del', a: midA[i++] });
    } else {
      mid.push({ op: 'ins', b: midB[j++] });
    }
  }
  while (i < n) mid.push({ op: 'del', a: midA[i++] });
  while (j < m) mid.push({ op: 'ins', b: midB[j++] });
  return [...head, ...mid, ...tail];
}

/** Words and the whitespace/punctuation between them, so joins are exact. */
const tokenize = (line: string) => line.match(/\w+|\s+|[^\w\s]/g) ?? [];

const pushSpan = (spans: DiffSpan[], text: string, changed: boolean) => {
  const last = spans.at(-1);
  if (last && last.changed === changed) last.text += text;
  else spans.push({ text, changed });
};

/** Marks the words that differ between a removed line and its replacement. */
export function diffWords(
  before: string,
  after: string
): { left: DiffSpan[]; right: DiffSpan[] } {
  const left: DiffSpan[] = [];
  const right: DiffSpan[] = [];
  for (const step of diffSeq(tokenize(before), tokenize(after))) {
    if (step.op === 'same') {
      pushSpan(left, step.a ?? '', false);
      pushSpan(right, step.b ?? '', false);
    } else if (step.op === 'del') {
      pushSpan(left, step.a ?? '', true);
    } else {
      pushSpan(right, step.b ?? '', true);
    }
  }
  return { left, right };
}

const whole = (text: string, changed: boolean): DiffSpan[] => [
  { text, changed },
];

/**
 * Line-aligned rows. A run of removed lines followed by added lines is paired
 * up row by row as "changed" (with word highlights); any surplus on one side
 * is a plain removal or addition.
 */
export function diffLines(before: string, after: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let removed: string[] = [];
  let added: string[] = [];

  const flush = () => {
    const paired = Math.min(removed.length, added.length);
    for (let k = 0; k < paired; k++) {
      const { left, right } = diffWords(removed[k], added[k]);
      rows.push({ kind: 'changed', left, right });
    }
    for (const line of removed.slice(paired)) {
      rows.push({ kind: 'removed', left: whole(line, true), right: null });
    }
    for (const line of added.slice(paired)) {
      rows.push({ kind: 'added', left: null, right: whole(line, true) });
    }
    removed = [];
    added = [];
  };

  for (const step of diffSeq(before.split('\n'), after.split('\n'))) {
    if (step.op === 'del') removed.push(step.a ?? '');
    else if (step.op === 'ins') added.push(step.b ?? '');
    else {
      flush();
      rows.push({
        kind: 'same',
        left: whole(step.a ?? '', false),
        right: whole(step.b ?? '', false),
      });
    }
  }
  flush();
  return rows;
}

const str = (value: unknown) => (typeof value === 'string' ? value : null);

/**
 * The file edits a permission prompt is asking about, or null when it isn't
 * an edit (or the JSON was clipped by the server's length cap and no longer
 * parses) — the caller then shows the raw detail as before.
 */
export function parseEditPreview(
  text: string,
  detail: string | null
): EditPreview | null {
  if (!detail) return null;
  let input: unknown;
  try {
    input = JSON.parse(detail);
  } catch {
    return null;
  }
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const path = str(record.file_path) ?? str(record.notebook_path) ?? '';
  const tool = /Allow\s+(\S+?)\?/.exec(text)?.[1] ?? 'Edit';

  // Edit: one replacement.
  const oldString = str(record.old_string);
  const newString = str(record.new_string);
  if (oldString !== null && newString !== null) {
    return { tool, edits: [{ path, before: oldString, after: newString }] };
  }

  // MultiEdit: several replacements in one file.
  if (Array.isArray(record.edits)) {
    const edits = record.edits.flatMap(edit => {
      const e = (edit ?? {}) as Record<string, unknown>;
      const before = str(e.old_string);
      const after = str(e.new_string);
      return before !== null && after !== null ? [{ path, before, after }] : [];
    });
    return edits.length ? { tool, edits } : null;
  }

  // Write: a whole file.
  const content = str(record.content);
  if (content !== null && path) {
    return { tool, edits: [{ path, before: null, after: content }] };
  }
  return null;
}

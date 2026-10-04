/**
 * Readable form of the tool input a permission prompt asks about.
 *
 * The prompt's `detail` is the tool input as JSON. File edits get their own
 * diff (see edit-diff.ts); every other tool — Bash above all — is laid out
 * here: what it says it is doing, the command it wants to run, and the rest
 * of its input as labelled fields, instead of one line of escaped JSON.
 */

/** One labelled input value. `block` values get their own box. */
export interface ToolField {
  label: string;
  value: string;
  block: boolean;
}

export interface ToolInputPreview {
  tool: string;
  /** The tool's own one-line account of what it is doing, if it gave one. */
  description: string | null;
  /** A shell command to run (Bash and the like). */
  command: string | null;
  fields: ToolField[];
}

// Longer one-line values read better in a box than squeezed beside a label.
const INLINE_MAX = 80;

/** `run_in_background` / `runInBackground` → "Run in background". */
const humanize = (key: string) => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const field = (key: string, raw: unknown): ToolField | null => {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'boolean') {
    return { label: humanize(key), value: raw ? 'yes' : 'no', block: false };
  }
  if (typeof raw === 'object') {
    return {
      label: humanize(key),
      value: JSON.stringify(raw, null, 2),
      block: true,
    };
  }
  const value = String(raw);
  return {
    label: humanize(key),
    value,
    block: value.includes('\n') || value.length > INLINE_MAX,
  };
};

/**
 * The tool input laid out for reading, or null when there is nothing to lay
 * out (no detail, or JSON clipped by the server's length cap that no longer
 * parses) — the caller then shows the raw detail as before.
 */
export function parseToolInput(
  text: string,
  detail: string | null
): ToolInputPreview | null {
  if (!detail) return null;
  let input: unknown;
  try {
    input = JSON.parse(detail);
  } catch {
    return null;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const tool = /Allow\s+(\S+?)\?/.exec(text)?.[1] ?? 'tool';

  const description =
    typeof record.description === 'string' && record.description.trim()
      ? record.description.trim()
      : null;
  const command = typeof record.command === 'string' ? record.command : null;
  const fields = Object.entries(record).flatMap(([key, value]) => {
    if (key === 'description' && description !== null) return [];
    if (key === 'command' && command !== null) return [];
    const f = field(key, value);
    return f ? [f] : [];
  });
  return { tool, description, command, fields };
}

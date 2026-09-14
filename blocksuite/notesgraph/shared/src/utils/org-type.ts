/**
 * Task types carried as an inline `#type:<x>` property on a task line
 * (`#type:bug`, `#type:epic` …). The plain-text token is the source of
 * truth — the block index already treats it as a `#key:value` prop, so
 * boards can filter on it — and the kanban card renders it as a badge.
 */

export type TaskTypeInfo = {
  /** the token value, lowercase (`bug`) */
  type: string;
  /** display label (`Bug`) */
  label: string;
  /** badge color */
  color: string;
};

export const TASK_TYPES: TaskTypeInfo[] = [
  { type: 'bug', label: 'Bug', color: '#eb4335' },
  { type: 'feature', label: 'Feature', color: '#8b7dff' },
  { type: 'chore', label: 'Chore', color: '#8e8d91' },
  { type: 'epic', label: 'Epic', color: '#ffb94a' },
];

const TYPE_TOKEN_RE = /(^|\s)#type:([a-z0-9][a-z0-9_-]*)/i;

/** Badge info for a type token; unknown types get a neutral color. */
export function taskTypeInfo(type: string): TaskTypeInfo {
  const canonical = TASK_TYPES.find(t => t.type === type.toLowerCase());
  if (canonical) return canonical;
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  return { type: type.toLowerCase(), label, color: '#1e96eb' };
}

/**
 * Finds the `#type:<x>` token in a task's text. Returns the type value and
 * the token's index/length (token only, not the preceding whitespace).
 */
export function parseTaskType(
  text: string
): { type: string; index: number; length: number } | null {
  const match = TYPE_TOKEN_RE.exec(text);
  if (!match) return null;
  const index = match.index + match[1].length;
  return {
    type: match[2].toLowerCase(),
    index,
    length: match[0].length - match[1].length,
  };
}

/**
 * A long-term goal is an ordinary task line carrying a `#goal` tag. The tag
 * keeps its real text (so search, the index and markdown see `#goal` like any
 * other tag) and carries `orgTag: 'goal'`, which renders it as a goal badge
 * rather than a plain tag chip.
 */

export const GOAL_TAG = 'goal';

const GOAL_TOKEN = `#${GOAL_TAG}`;

/** `#goal` as a whole token: not `#goals`, not `#goal:x`, not `a#goal`. */
const GOAL_TOKEN_RE = /(^|\s)#goal(?=\s|$)/i;

/** The text operations toggling needs; a block model's `Text` has them all. */
export interface GoalTaggableText {
  toString(): string;
  toDelta(): { insert?: string; attributes?: Record<string, unknown> }[];
  insert(
    content: string,
    index: number,
    attributes?: Record<string, unknown>
  ): void;
  delete(index: number, length: number): void;
}

export function hasGoalTag(text: string): boolean {
  return GOAL_TOKEN_RE.test(text);
}

/**
 * Where a new tag goes: after the words, before the STARTED/SCHEDULED badges
 * at the end of the line, so the tag reads as part of the task.
 */
function tagInsertIndex(text: GoalTaggableText): number {
  let offset = 0;
  for (const op of text.toDelta()) {
    if (typeof op.attributes?.orgTimestamp === 'string') break;
    offset += op.insert?.length ?? 0;
  }
  const before = text.toString().slice(0, offset);
  return before.trimEnd().length;
}

/**
 * Marks a task as a goal, or unmarks it if it already is one.
 * Returns whether the line is a goal afterwards.
 */
export function toggleGoalTag(text: GoalTaggableText): boolean {
  const plain = text.toString();
  const match = GOAL_TOKEN_RE.exec(plain);
  if (match) {
    const tokenStart = match.index + match[1].length;
    // Take the space in front with it, so no double space is left behind.
    const start = match[1].length > 0 ? match.index : tokenStart;
    const end =
      match[1].length === 0 && plain[tokenStart + GOAL_TOKEN.length] === ' '
        ? tokenStart + GOAL_TOKEN.length + 1
        : tokenStart + GOAL_TOKEN.length;
    text.delete(start, end - start);
    return false;
  }

  const index = tagInsertIndex(text);
  const after = plain.slice(index);
  // Whitespace the trim stepped over is reused as the separator after the tag.
  if (after.length > 0 && !/^\s/.test(after)) text.insert(' ', index);
  text.insert(GOAL_TOKEN, index, { orgTag: GOAL_TAG });
  if (index > 0) text.insert(' ', index);
  return true;
}

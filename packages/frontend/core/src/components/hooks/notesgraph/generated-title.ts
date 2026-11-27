/** Longest title kept from a model's reply; a title is not a summary. */
const MAX_TITLE_CHARS = 80;

/**
 * Most of a note to hand the model: the opening says what a note is about,
 * and a small on-device model can't take a long one whole.
 */
export const TITLE_SOURCE_CHARS = 6_000;

/**
 * The title in a model's reply. Models wrap it in quotes, mark it as a
 * heading, lead with "Title:" or add an explanation on the next line, none of
 * which belongs in the note's title.
 */
export function cleanGeneratedTitle(reply: string): string {
  const line =
    reply
      .split('\n')
      .map(text => text.trim())
      .find(text => text.length > 0) ?? '';
  let title = line
    .replace(/^#+\s*/, '')
    .replace(/^\*\*(.*)\*\*$/, '$1')
    .replace(/^title\s*:\s*/i, '')
    .replace(/^["'“‘`]+|["'”’`]+$/g, '')
    .replace(/\.$/, '')
    .trim();
  if (title.length > MAX_TITLE_CHARS) {
    title = `${title.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
  }
  return title;
}

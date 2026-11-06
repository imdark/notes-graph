/**
 * Decides what the nightly enrichment does with a note, from its title and
 * body text alone.
 */

export const MAX_GENERATED_TITLE_CHARS = 60;

export type DocEnrichment =
  | { action: 'keep' }
  | { action: 'flagEmpty' }
  | { action: 'setTitle'; title: string };

/**
 * A title from the first line of the body: the first sentence, cut at a word
 * boundary when it is long. Null when the body has no words to use.
 */
export function generateTitle(body: string): string | null {
  const firstLine = body
    .split(/\r?\n/)
    .map(line => line.replace(/^[\s#>*\-•\d.)\]\[]+/, '').trim())
    .find(Boolean);
  if (!firstLine) return null;

  const sentence = firstLine
    .split(/(?<=[.!?])\s/)[0]
    .replace(/[.!?:,;\s]+$/, '');
  if (!sentence) return null;
  if (sentence.length <= MAX_GENERATED_TITLE_CHARS) return sentence;

  const cut = sentence.slice(0, MAX_GENERATED_TITLE_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).replace(
    /[.,;:\s]+$/,
    ''
  );
  return `${trimmed}…`;
}

export function enrichDoc(doc: {
  title?: string | null;
  body: string;
}): DocEnrichment {
  if (doc.title?.trim()) return { action: 'keep' };
  const title = generateTitle(doc.body);
  return title ? { action: 'setTitle', title } : { action: 'flagEmpty' };
}

/**
 * What "Save as doc" needs from a chat answer's markdown: a title for the new
 * note, and the notes the answer cited, so the saved note links to them as
 * real graph references instead of only footnote chips.
 */

const FOOTNOTE_DEFINITION = /^\[\^[^\]]+\]:\s*(\{.*\})\s*$/;
const FOOTNOTE_REFERENCE = /\[\^[^\]]+\]/g;
const TITLE_LIMIT = 80;

export interface SavedAnswer {
  title: string;
  /** Cited notes, in the order the answer first cites them, without repeats. */
  docIds: string[];
}

export function savedAnswer(markdown: string): SavedAnswer {
  const docIds: string[] = [];
  const body: string[] = [];
  for (const line of markdown.split('\n')) {
    const definition = FOOTNOTE_DEFINITION.exec(line.trim());
    if (!definition) {
      body.push(line);
      continue;
    }
    try {
      const reference = JSON.parse(definition[1]) as {
        type?: string;
        docId?: string;
      };
      if (
        reference.type === 'doc' &&
        reference.docId &&
        !docIds.includes(reference.docId)
      ) {
        docIds.push(reference.docId);
      }
    } catch {
      // Not a citation the app wrote; leave it out of both.
    }
  }
  return { title: answerTitle(body.join('\n')), docIds };
}

/** The answer's first heading, or else its first line, as plain text. */
function answerTitle(markdown: string): string {
  const lines = markdown
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('```'));
  const line = lines.find(l => /^#{1,6}\s/.test(l)) ?? lines[0] ?? '';
  const text = line
    .replace(FOOTNOTE_REFERENCE, '')
    .replace(/^#{1,6}\s+|^[-*+>]\s+|^\d+[.)]\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= TITLE_LIMIT) return text;
  const cut = text.slice(0, TITLE_LIMIT);
  const space = cut.lastIndexOf(' ');
  return `${(space > TITLE_LIMIT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

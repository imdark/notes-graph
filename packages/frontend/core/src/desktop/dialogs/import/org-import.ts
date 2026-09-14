/**
 * Orgzly (org-mode) → NotesGraph.
 *
 * Orgzly stores each notebook as an `.org` file and syncs a folder of them
 * (Dropbox / local). This module holds the pure conversion from org-mode text
 * to markdown; the import dialog wires it to the directory picker and doc
 * creation. Focus is on the structural elements Orgzly actually uses:
 * headlines (with TODO/DONE keywords and tags), property/logbook drawers,
 * planning lines, lists, and links.
 */

const DONE_KEYWORDS = new Set(['DONE', 'CANCELLED', 'CANCELED']);
const TODO_KEYWORDS = new Set([
  'TODO',
  'NEXT',
  'STARTED',
  'WAITING',
  'HOLD',
  'SOMEDAY',
  'LATER',
]);

export interface OrgDoc {
  /** Notebook title — `#+TITLE:` if present, else the file name. */
  title: string;
  markdown: string;
}

/** Convert org inline markup that has a clean markdown equivalent. */
function inlineOrgToMd(s: string): string {
  return (
    s
      // [[url][description]] and [[url]]
      .replace(/\[\[([^\]]+)\]\[([^\]]+)\]\]/g, '[$2]($1)')
      .replace(/\[\[([^\]]+)\]\]/g, '<$1>')
      // =verbatim= and ~code~ → `code`
      .replace(/(^|[\s(])[=~]([^=~\n]+)[=~](?=[\s).,;:!?]|$)/g, '$1`$2`')
  );
}

/** Split a headline's trailing `:tag1:tag2:` into `#tag1 #tag2`. */
function splitTags(text: string): { text: string; tags: string } {
  const m = /\s+(:[A-Za-z0-9_@#%:]+:)\s*$/.exec(text);
  if (!m) return { text, tags: '' };
  const tags = m[1]
    .split(':')
    .filter(Boolean)
    .map(t => `#${t}`)
    .join(' ');
  return { text: text.slice(0, m.index).trimEnd(), tags };
}

export function orgToMarkdown(org: string, fileName = 'Untitled'): OrgDoc {
  const lines = org.split(/\r?\n/);
  const out: string[] = [];
  let title = '';
  let inDrawer = false;

  for (const line of lines) {
    // #+TITLE: and other export/option keywords
    const titleMatch = /^#\+TITLE:\s*(.*)$/i.exec(line);
    if (titleMatch) {
      title = titleMatch[1].trim();
      continue;
    }
    if (/^#\+\w/.test(line)) continue; // #+OPTIONS:, #+STARTUP:, …

    // :PROPERTIES:/:LOGBOOK: … :END: drawers — skip their contents
    if (/^\s*:(PROPERTIES|LOGBOOK):\s*$/i.test(line)) {
      inDrawer = true;
      continue;
    }
    if (inDrawer) {
      if (/^\s*:END:\s*$/i.test(line)) inDrawer = false;
      continue;
    }

    // SCHEDULED:/DEADLINE:/CLOSED: planning lines
    if (/^\s*(SCHEDULED|DEADLINE|CLOSED):/i.test(line)) {
      out.push(`> ${line.trim().replace(/[<>[\]]/g, '')}`, '');
      continue;
    }

    // Headline: *…  [KEYWORD]  text  [:tags:]
    const hl = /^(\*+)\s+(.*)$/.exec(line);
    if (hl) {
      const level = hl[1].length;
      let rest = hl[2];
      const { text: noTags, tags } = splitTags(rest);
      rest = noTags;

      let keyword = '';
      const kw = /^([A-Z][A-Z-]+)\s+(.*)$/.exec(rest);
      if (kw && (TODO_KEYWORDS.has(kw[1]) || DONE_KEYWORDS.has(kw[1]))) {
        keyword = kw[1];
        rest = kw[2];
      }

      const body = inlineOrgToMd(rest);
      const suffix = tags ? ` ${tags}` : '';

      if (keyword) {
        // A task headline → a checkbox, indented to reflect the outline depth.
        const indent = '  '.repeat(Math.max(0, level - 1));
        const box = DONE_KEYWORDS.has(keyword) ? '[x]' : '[ ]';
        out.push(`${indent}- ${box} ${body}${suffix}`);
      } else {
        const h = '#'.repeat(Math.min(level, 6));
        out.push('', `${h} ${body}${suffix}`, '');
      }
      continue;
    }

    // Org list checkbox uses [X]; normalize to markdown [x].
    out.push(inlineOrgToMd(line.replace(/^(\s*[-+*]\s+)\[X\]/, '$1[x]')));
  }

  const markdown = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title: title || fileName, markdown };
}

/**
 * Turning an AI answer into the markdown of a note of its own.
 *
 * An answer cites what it drew on as footnotes — `claim[^1]` in the text and
 * `[^1]: {"type":"doc","docId":"…"}` (or `"type":"url"`) definitions at the
 * end. Imported as they are, those become footnote chips, which the notes
 * graph does not see: a saved answer would not show up in the backlinks of
 * the notes it cites. So the citations are rewritten into plain links — a
 * cited note into a link the markdown importer turns into a doc reference
 * (see `docLinkBaseURLMiddleware`), a web page into an ordinary URL link —
 * and listed again under "Sources" at the end.
 */

/** One footnote definition the answer cites. */
export interface AnswerCitation {
  label: string;
  /** `doc`, `url`, `attachment`, … as in `FootNoteReferenceParamsSchema`. */
  type: string;
  docId?: string;
  url?: string;
  title?: string;
  fileName?: string;
}

/** A note the answer came from without citing it, e.g. the one an agent ran on. */
export interface AnswerSource {
  docId: string;
  blockId?: string;
}

export interface AnswerToNoteOptions {
  /**
   * The link to a note in this workspace, in the form the markdown importer
   * turns into a doc reference: `${origin}/workspace/${workspaceId}/${docId}`.
   */
  docUrl: (docId: string, blockId?: string) => string;
  /** A cited note's title, for the link's text. */
  docTitle?: (docId: string) => string | undefined;
  /** Notes to list under Sources beside the cited ones, first. */
  sources?: AnswerSource[];
}

const DEFINITION = /^\s{0,3}\[\^([^\]\s]+)\]:\s*(\{.*\})\s*$/;
const REFERENCE = /\[\^([^\]\s]+)\](?!:)/g;
const FENCE = /^\s{0,3}(```|~~~)/;

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const parseDefinition = (
  label: string,
  json: string
): AnswerCitation | null => {
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || typeof value.type !== 'string') {
      return null;
    }
    const str = (key: string) =>
      typeof value[key] === 'string' && value[key]
        ? (value[key] as string)
        : undefined;
    const url = str('url');
    return {
      label,
      type: value.type,
      docId: str('docId'),
      // The server encodes URLs in definitions; the footnote adapter decodes.
      url: url ? safeDecode(url) : undefined,
      title: str('title'),
      fileName: str('fileName'),
    };
  } catch {
    return null;
  }
};

/** Runs `fn` over each line outside fenced code blocks. */
const mapOutsideCode = (
  markdown: string,
  fn: (line: string) => string | null
): string => {
  let inFence: string | null = null;
  const out: string[] = [];
  for (const line of markdown.split('\n')) {
    const fence = FENCE.exec(line)?.[1];
    if (inFence) {
      if (fence === inFence) inFence = null;
      out.push(line);
      continue;
    }
    if (fence) {
      inFence = fence;
      out.push(line);
      continue;
    }
    const mapped = fn(line);
    if (mapped !== null) out.push(mapped);
  }
  return out.join('\n');
};

/**
 * Splits the answer into its text and the citations defined in it; the
 * definition lines are taken out of the text. Footnotes whose definition is
 * not a citation (plain-text footnotes) are left alone.
 */
export function parseCitations(markdown: string): {
  body: string;
  citations: Map<string, AnswerCitation>;
} {
  const citations = new Map<string, AnswerCitation>();
  const body = mapOutsideCode(markdown, line => {
    const match = DEFINITION.exec(line);
    if (!match) return line;
    const citation = parseDefinition(match[1], match[2]);
    if (!citation) return line;
    citations.set(citation.label, citation);
    return null;
  });
  return { body: body.replace(/\n{3,}/g, '\n\n').trimEnd(), citations };
}

/** Escapes text for inside a markdown link's `[…]`. */
const linkText = (text: string) =>
  text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([\\[\]])/g, '\\$1');

/** Makes a URL safe for inside a markdown link's `(…)`. */
const linkTarget = (url: string) =>
  url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
};

const docLink = (
  docId: string,
  options: AnswerToNoteOptions,
  blockId?: string
) => {
  const title = options.docTitle?.(docId) || 'Untitled';
  return `[${linkText(title)}](${linkTarget(options.docUrl(docId, blockId))})`;
};

const urlLink = (citation: AnswerCitation, short: boolean) => {
  const url = citation.url as string;
  const text = citation.title || (short ? hostOf(url) : url);
  return `[${linkText(text)}](${linkTarget(url)})`;
};

/** What a `[^n]` in the text becomes; empty for what can't be linked. */
const inlineLink = (
  citation: AnswerCitation,
  options: AnswerToNoteOptions
): string => {
  if (citation.type === 'doc' && citation.docId) {
    return docLink(citation.docId, options);
  }
  if (citation.url) {
    return `(${urlLink(citation, true)})`;
  }
  return '';
};

/** Replaces `[^n]` references in one line, outside inline code. */
const replaceReferences = (
  line: string,
  citations: Map<string, AnswerCitation>,
  options: AnswerToNoteOptions
) =>
  line
    .split(/(`[^`]*`)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(REFERENCE, (match, label: string, offset: number) => {
            const citation = citations.get(label);
            if (!citation) return match;
            const link = inlineLink(citation, options);
            if (!link) return '';
            const before = offset > 0 ? part[offset - 1] : '';
            return before && !/\s/.test(before) ? ` ${link}` : link;
          })
    )
    .join('');

/** The "Sources" list: each cited or given source once, in order. */
const sourceLines = (
  citations: Map<string, AnswerCitation>,
  options: AnswerToNoteOptions
): string[] => {
  const seen = new Set<string>();
  const lines: string[] = [];
  const add = (key: string, line: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(`- ${line}`);
  };
  for (const source of options.sources ?? []) {
    add(
      `doc:${source.docId}:${source.blockId ?? ''}`,
      docLink(source.docId, options, source.blockId)
    );
  }
  for (const citation of citations.values()) {
    if (citation.type === 'doc' && citation.docId) {
      add(`doc:${citation.docId}:`, docLink(citation.docId, options));
    } else if (citation.url) {
      add(`url:${citation.url}`, urlLink(citation, false));
    } else if (citation.fileName || citation.title) {
      const name = (citation.fileName || citation.title) as string;
      add(`file:${name}`, name.replace(/([\\[\]*_`])/g, '\\$1'));
    }
  }
  return lines;
};

/**
 * The answer as the markdown of a note: citations turned into doc and URL
 * links in place, and gathered under "Sources" at the end.
 */
export function answerToNoteMarkdown(
  markdown: string,
  options: AnswerToNoteOptions
): string {
  const { body, citations } = parseCitations(markdown);
  const text = mapOutsideCode(body, line =>
    replaceReferences(line, citations, options)
  );
  const sources = sourceLines(citations, options);
  if (!sources.length) return text;
  return `${text}\n\n## Sources\n\n${sources.join('\n')}\n`;
}

const TITLE_MAX = 80;

/** Markdown inline syntax stripped, for a title. */
const plain = (text: string) =>
  text
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A title for the saved answer, and its text without it: a heading the
 * answer opens with becomes the title (and leaves the text, so it isn't
 * there twice); otherwise the first line, cut short.
 */
export function deriveNoteTitle(markdown: string): {
  title: string;
  body: string;
} {
  const lines = markdown.split('\n');
  const first = lines.findIndex(line => line.trim() !== '');
  if (first === -1) return { title: '', body: markdown };
  const line = lines[first];
  const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
  if (heading) {
    const title = plain(heading[1]);
    if (title) {
      return {
        title,
        // A rule under the heading goes with it: the importer would read a
        // note opening with `---` as frontmatter.
        body: lines
          .slice(first + 1)
          .join('\n')
          .replace(
            /^\n*(?:[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*(?:\n|$))?\n*/,
            ''
          ),
      };
    }
  }
  if (FENCE.test(line)) return { title: '', body: markdown };
  const text = plain(line.replace(/^\s*(?:[-*+>]|\d+[.)])\s+/, ''));
  if (text.length <= TITLE_MAX) return { title: text, body: markdown };
  const cut = text.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(' ');
  return {
    title: `${(space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`,
    body: markdown,
  };
}

/**
 * Identity and change-detection helpers for files in a bound folder.
 *
 * A synced file carries its note's id in YAML frontmatter (`notesgraph-id`).
 * That is what makes the mapping survive things a path-keyed index cannot: the
 * user renaming the file in Finder, moving it to another subfolder, or
 * unbinding and re-binding the folder later. The path index is a fast lookup;
 * the stamp in the file is the source of truth.
 */

/** Frontmatter key holding the note id. Deliberately namespaced. */
export const DOC_ID_KEY = 'notesgraph-id';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** The note id stamped into this markdown, if any. */
export function readDocId(markdown: string): string | null {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return null;
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    if (line.slice(0, sep).trim() !== DOC_ID_KEY) continue;
    const value = line
      .slice(sep + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    return value || null;
  }
  return null;
}

/**
 * Return `markdown` carrying `docId`, adding or replacing the frontmatter key
 * while leaving every other key (and the body) untouched — the file may well
 * have frontmatter the user wrote, and sync must not eat it.
 */
export function stampDocId(markdown: string, docId: string): string {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) {
    return `---\n${DOC_ID_KEY}: ${docId}\n---\n\n${markdown.replace(/^\n+/, '')}`;
  }

  const body = markdown.slice(match[0].length);
  const lines = match[1].split(/\r?\n/);
  const index = lines.findIndex(line => {
    const sep = line.indexOf(':');
    return sep !== -1 && line.slice(0, sep).trim() === DOC_ID_KEY;
  });

  if (index === -1) {
    lines.push(`${DOC_ID_KEY}: ${docId}`);
  } else {
    lines[index] = `${DOC_ID_KEY}: ${docId}`;
  }
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** Drop the id stamp so it never shows up as content when importing. */
export function stripDocId(markdown: string): string {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return markdown;

  const kept = match[1].split(/\r?\n/).filter(line => {
    const sep = line.indexOf(':');
    return sep === -1 || line.slice(0, sep).trim() !== DOC_ID_KEY;
  });
  const body = markdown.slice(match[0].length);
  // An id-only frontmatter block leaves nothing worth keeping.
  return kept.some(l => l.trim())
    ? `---\n${kept.join('\n')}\n---\n${body}`
    : body;
}

/**
 * Content hash used to decide whether anything actually changed.
 *
 * Sync writes are gated on this on both sides. That is not an optimisation:
 * writing a file whose bytes already match would fire the folder observer,
 * which would re-import the note, which would re-export the file — a loop.
 * The same trap bit `writeSiteManifest`, where a re-set of an identical value
 * still produced a CRDT update and re-stamped the note's "Updated" time.
 *
 * SHA-256 rather than a cheap non-cryptographic hash: a collision here means a
 * real edit is silently skipped, which reads to the user as lost work.
 */
export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Filename (no extension) → note title, and back. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[^/.]+$/, '');
}

/**
 * A filesystem-safe file name for a note title. Falls back to the note id so a
 * note titled "" or "///" still round-trips to something openable.
 */
export function fileNameForTitle(title: string, docId: string): string {
  const safe = title
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/\.+$/, '');
  return `${safe || docId}.md`;
}

export function isMarkdownPath(path: string): boolean {
  return /\.mdx?$/i.test(path);
}

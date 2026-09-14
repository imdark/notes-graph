/**
 * Google Keep (Takeout) → NotesGraph.
 *
 * A Keep Takeout export is a folder of one `.json` file per note (alongside
 * `.html` renderings and attachment blobs). This module holds the pure
 * conversion from a Keep note object to markdown + metadata; the import dialog
 * wires it to the directory picker and doc/tag creation.
 */

export interface KeepListItem {
  text?: string;
  isChecked?: boolean;
}

export interface KeepAnnotation {
  url?: string;
  title?: string;
  source?: string;
}

export interface KeepAttachment {
  filePath?: string;
  mimetype?: string;
}

export interface KeepNote {
  title?: string;
  color?: string;
  isTrashed?: boolean;
  isPinned?: boolean;
  isArchived?: boolean;
  textContent?: string;
  listContent?: KeepListItem[];
  labels?: { name?: string }[];
  annotations?: KeepAnnotation[];
  attachments?: KeepAttachment[];
  userEditedTimestampUsec?: number;
}

export interface KeepConverted {
  /** Doc title — the note title, else its first line, else "Untitled". */
  title: string;
  markdown: string;
  labels: string[];
  isTrashed: boolean;
  isArchived: boolean;
  isPinned: boolean;
}

/** True if `value` looks like a Keep note export (vs. some other Takeout json). */
export function isKeepNote(value: unknown): value is KeepNote {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    'textContent' in v ||
    'listContent' in v ||
    ('title' in v &&
      ('isTrashed' in v || 'isArchived' in v || 'isPinned' in v || 'color' in v))
  );
}

const firstLine = (text: string): string =>
  text.split('\n').map(l => l.trim()).find(Boolean) ?? '';

/** Convert one Keep note to markdown + the metadata the importer needs. */
export function keepNoteToMarkdown(note: KeepNote): KeepConverted {
  const lines: string[] = [];

  if (note.listContent && note.listContent.length > 0) {
    // A checklist note → markdown todo items.
    for (const item of note.listContent) {
      const box = item.isChecked ? '[x]' : '[ ]';
      lines.push(`- ${box} ${(item.text ?? '').trim()}`.trimEnd());
    }
  } else if (note.textContent) {
    lines.push(note.textContent.trim());
  }

  // Weblink annotations Keep attached to the note.
  const links = (note.annotations ?? []).filter(a => a.url);
  if (links.length > 0) {
    lines.push('');
    for (const a of links) {
      lines.push(`- [${a.title?.trim() || a.url}](${a.url})`);
    }
  }

  // Attachments: reference by name (blob embedding is a follow-up).
  const attachments = (note.attachments ?? []).filter(a => a.filePath);
  if (attachments.length > 0) {
    lines.push('');
    for (const a of attachments) {
      lines.push(`> 📎 Attachment: ${a.filePath}`);
    }
  }

  const markdown = lines.join('\n').trim();
  const title = (note.title ?? '').trim() || firstLine(markdown) || 'Untitled';

  return {
    title,
    markdown,
    labels: (note.labels ?? [])
      .map(l => (l.name ?? '').trim())
      .filter(Boolean),
    isTrashed: !!note.isTrashed,
    isArchived: !!note.isArchived,
    isPinned: !!note.isPinned,
  };
}

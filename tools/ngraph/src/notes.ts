import * as Y from 'yjs';

import { docTitle, docToMarkdown } from './render';
import type { DocMeta, Transport } from './transport';

export async function listNotes(t: Transport): Promise<DocMeta[]> {
  const metas = await t.listDocMetas();
  return metas.sort((a, b) => (b.updatedDate ?? 0) - (a.updatedDate ?? 0));
}

export async function loadDoc(
  t: Transport,
  id: string
): Promise<Y.Doc | null> {
  const bin = await t.getDocBin(id);
  if (!bin) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bin);
  return doc;
}

export interface NoteView {
  id: string;
  title: string;
  markdown: string;
}

export async function viewNote(
  t: Transport,
  id: string
): Promise<NoteView | null> {
  const doc = await loadDoc(t, id);
  if (!doc) return null;
  return {
    id,
    title: docTitle(doc) || '(untitled)',
    markdown: docToMarkdown(doc),
  };
}

export async function createNote(
  t: Transport,
  title: string,
  markdown: string
): Promise<string> {
  if (!t.createNote) {
    throw new Error(
      'Creating notes requires a live backend — run `ngraph login` first.'
    );
  }
  return t.createNote(title, markdown);
}

export async function editNote(
  t: Transport,
  id: string,
  markdown: string
): Promise<void> {
  if (!t.editNote) {
    throw new Error(
      'Editing notes requires a live backend — run `ngraph login` first.'
    );
  }
  await t.editNote(id, markdown);
}

/** Append markdown to a note's existing body (e.g. an AI memory log). */
export async function appendNote(
  t: Transport,
  id: string,
  markdown: string
): Promise<void> {
  const current = await viewNote(t, id);
  if (!current) throw new Error(`Note not found: ${id}`);
  // `viewNote` renders the body only (title is separate), so append directly.
  const body = current.markdown.trimEnd();
  await editNote(t, id, (body ? `${body}\n\n${markdown}` : markdown).trim());
}

export interface SearchHit extends DocMeta {
  snippet?: string;
}

/** Match on title; with `content`, also grep rendered markdown. */
export async function searchNotes(
  t: Transport,
  query: string,
  opts: { content?: boolean } = {}
): Promise<SearchHit[]> {
  const q = query.toLowerCase();
  const metas = await t.listDocMetas();
  const hits: SearchHit[] = metas.filter(m =>
    m.title.toLowerCase().includes(q)
  );
  if (!opts.content) return hits;

  const seen = new Set(hits.map(h => h.id));
  for (const meta of metas) {
    if (seen.has(meta.id)) continue;
    const view = await viewNote(t, meta.id);
    const idx = view?.markdown.toLowerCase().indexOf(q) ?? -1;
    if (view && idx >= 0) {
      hits.push({
        ...meta,
        snippet: view.markdown
          .slice(Math.max(0, idx - 30), idx + 60)
          .replace(/\s+/g, ' ')
          .trim(),
      });
    }
  }
  return hits;
}

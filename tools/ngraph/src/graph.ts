import * as Y from 'yjs';

import { listNotes, loadDoc } from './notes';
import type { DocMeta, Transport } from './transport';

export interface Link {
  /** The referenced doc id. */
  pageId: string;
  /** Referenced doc's title, resolved from the workspace doc list if known. */
  title?: string;
  /** LinkedPage, etc. */
  type?: string;
}

/** Pull every inline doc-reference out of a loaded page doc's block text. */
export function extractLinks(doc: Y.Doc): Link[] {
  const blocks = doc.getMap('blocks');
  const seen = new Set<string>();
  const links: Link[] = [];
  for (const value of blocks.values()) {
    if (!(value instanceof Y.Map)) continue;
    const text = value.get('prop:text');
    if (!(text instanceof Y.Text)) continue;
    for (const op of text.toDelta() as Array<{
      attributes?: { reference?: { pageId?: string; type?: string } };
    }>) {
      const ref = op.attributes?.reference;
      if (ref?.pageId && !seen.has(ref.pageId)) {
        seen.add(ref.pageId);
        links.push({ pageId: ref.pageId, type: ref.type });
      }
    }
  }
  return links;
}

function titleIndex(metas: DocMeta[]): Map<string, string> {
  return new Map(metas.map(m => [m.id, m.title]));
}

/** Plain text of every block that references `targetId`, for context digests. */
export function referenceContexts(doc: Y.Doc, targetId: string): string[] {
  const blocks = doc.getMap('blocks');
  const contexts: string[] = [];
  for (const value of blocks.values()) {
    if (!(value instanceof Y.Map)) continue;
    const text = value.get('prop:text');
    if (!(text instanceof Y.Text)) continue;
    const delta = text.toDelta() as Array<{
      insert?: unknown;
      attributes?: { reference?: { pageId?: string } };
    }>;
    if (!delta.some(op => op.attributes?.reference?.pageId === targetId)) {
      continue;
    }
    const plain = delta
      .map(op => (typeof op.insert === 'string' ? op.insert : ' '))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    contexts.push(plain || '(reference)');
  }
  return contexts;
}

/** Outgoing references from a note. */
export async function links(t: Transport, id: string): Promise<Link[]> {
  const doc = await loadDoc(t, id);
  if (!doc) throw new Error(`Note not found: ${id}`);
  const titles = titleIndex(await t.listDocMetas());
  return extractLinks(doc).map(l => ({ ...l, title: titles.get(l.pageId) }));
}

export interface Backlink extends DocMeta {}

/** Notes that reference `id` (scans the whole workspace). */
export async function backlinks(
  t: Transport,
  id: string
): Promise<Backlink[]> {
  const metas = await listNotes(t);
  const hits: Backlink[] = [];
  for (const meta of metas) {
    if (meta.id === id) continue;
    const doc = await loadDoc(t, meta.id);
    if (!doc) continue;
    if (extractLinks(doc).some(l => l.pageId === id)) {
      hits.push(meta);
    }
  }
  return hits;
}

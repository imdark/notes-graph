import { extractLinks, referenceContexts } from './graph';
import { appendNote, createNote, listNotes, loadDoc, viewNote } from './notes';
import type { DocMeta, Transport } from './transport';

/** ISO `YYYY-MM-DD` for a Date (local time) — the journal note title format. */
function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function hhmm(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface CaptureResult {
  id: string;
  title: string;
  created: boolean;
}

/**
 * Append a timestamped line to today's journal note (or a named note),
 * creating it if needed. The quick-capture inbox for an AI's observations.
 */
export async function capture(
  t: Transport,
  text: string,
  opts: { title?: string; now?: Date } = {}
): Promise<CaptureResult> {
  const clean = text.trim();
  if (!clean) throw new Error('Nothing to capture.');
  const now = opts.now ?? new Date();
  const title = opts.title ?? isoDate(now);
  const line = `- ${hhmm(now)} ${clean}`;

  const metas = await listNotes(t);
  const existing = metas.find(m => m.title === title);
  if (existing) {
    await appendNote(t, existing.id, line);
    return { id: existing.id, title, created: false };
  }
  const id = await createNote(t, title, line);
  return { id, title, created: true };
}

// A small stopword list keeps term-overlap scoring meaningful.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her',
  'was', 'one', 'our', 'out', 'has', 'have', 'had', 'his', 'him', 'she', 'they',
  'them', 'this', 'that', 'with', 'from', 'your', 'will', 'what', 'when', 'which',
  'their', 'there', 'would', 'about', 'into', 'than', 'then', 'some', 'were',
  'been', 'more', 'also', 'like', 'just', 'over', 'such', 'only', 'other',
]);

function terms(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [];
  return new Set(words.filter(w => !STOPWORDS.has(w)));
}

function mentions(haystack: string, needle: string): boolean {
  return needle.length > 2 && haystack.toLowerCase().includes(needle.toLowerCase());
}

export interface Suggestion {
  id: string;
  title: string;
  score: number;
  reason: string;
}

/**
 * Rank other notes as candidate links for `id` by shared vocabulary, with a
 * bonus when either note names the other by title. Excludes self and existing
 * links — the AI can then act on these via `connect`.
 */
export async function suggestLinks(
  t: Transport,
  id: string,
  opts: { limit?: number } = {}
): Promise<Suggestion[]> {
  const target = await viewNote(t, id);
  if (!target) throw new Error(`Note not found: ${id}`);
  const targetDoc = await loadDoc(t, id);
  const skip = new Set<string>([id]);
  if (targetDoc) {
    for (const l of extractLinks(targetDoc)) skip.add(l.pageId);
  }
  const targetTerms = terms(`${target.title} ${target.markdown}`);

  const metas = await listNotes(t);
  const suggestions: Suggestion[] = [];
  for (const meta of metas) {
    if (skip.has(meta.id)) continue;
    const view = await viewNote(t, meta.id);
    if (!view) continue;
    const otherTerms = terms(`${view.title} ${view.markdown}`);
    let shared = 0;
    for (const term of targetTerms) {
      if (otherTerms.has(term)) shared++;
    }
    const mentionBonus =
      (mentions(target.markdown, view.title) ? 4 : 0) +
      (mentions(view.markdown, target.title) ? 4 : 0);
    const score = shared + mentionBonus;
    if (score <= 0) continue;
    suggestions.push({
      id: meta.id,
      title: view.title,
      score,
      reason: mentionBonus
        ? `names the other note + ${shared} shared term(s)`
        : `${shared} shared term(s)`,
    });
  }
  return suggestions
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 5);
}

export interface BacklinkDigest {
  id: string;
  title: string;
  contexts: string[];
}

/** Backlinks to `id` with the text of each referencing block. */
export async function summarizeBacklinks(
  t: Transport,
  id: string
): Promise<BacklinkDigest[]> {
  const metas = await listNotes(t);
  const digests: BacklinkDigest[] = [];
  for (const meta of metas) {
    if (meta.id === id) continue;
    const doc = await loadDoc(t, meta.id);
    if (!doc) continue;
    const contexts = referenceContexts(doc, id);
    if (contexts.length) {
      digests.push({ id: meta.id, title: meta.title, contexts });
    }
  }
  return digests;
}

/** Notes with no outgoing and no incoming links — disconnected from the graph. */
export async function findOrphans(t: Transport): Promise<DocMeta[]> {
  const metas = await listNotes(t);
  const outgoingCount = new Map<string, number>();
  const hasIncoming = new Set<string>();
  for (const meta of metas) {
    const doc = await loadDoc(t, meta.id);
    const links = doc ? extractLinks(doc) : [];
    outgoingCount.set(meta.id, links.length);
    for (const l of links) hasIncoming.add(l.pageId);
  }
  return metas.filter(
    m => (outgoingCount.get(m.id) ?? 0) === 0 && !hasIncoming.has(m.id)
  );
}

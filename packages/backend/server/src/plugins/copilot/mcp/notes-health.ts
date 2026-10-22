/**
 * The part of a notes health check that needs no judgement: which notes
 * nothing links to, which links point at notes that are gone, which titles
 * say the same thing, which notes are nearly empty, and which dated facts
 * have gone stale. The health-check agent gets these from the notes_health
 * tool rather than guessing them from searches, and spends its own reading on
 * what does need judgement (whether two notes really are duplicates, whether
 * two notes contradict each other).
 *
 * Everything here works on what the search index already holds, so it is
 * plain data in and plain data out.
 */

export interface HealthDoc {
  docId: string;
  title: string;
  /** The index's plain-text summary of the note's body. */
  summary: string;
  /** Journal days are reached by date, not by links, so they are never orphans. */
  journal?: boolean;
}

/** One block of `fromDocId` that links to `toDocId`. */
export interface HealthLink {
  fromDocId: string;
  toDocId: string;
}

/** A block whose text may carry an "as of <date>" stamp. */
export interface HealthBlock {
  docId: string;
  blockId: string;
  text: string;
}

export interface NotesHealthOptions {
  now: Date;
  /** A fact stamped longer ago than this is reported as stale. */
  staleDays?: number;
  /** A note whose body is shorter than this many characters is a stub. */
  stubChars?: number;
}

type DocRef = { docId: string; title: string };

export interface NotesHealthReport {
  orphans: DocRef[];
  brokenLinks: { fromDocId: string; fromTitle: string; toDocId: string }[];
  duplicateTitles: { title: string; docs: DocRef[] }[];
  stubs: (DocRef & { chars: number })[];
  staleFacts: (DocRef & {
    blockId: string;
    text: string;
    asOf: string;
    ageDays: number;
  })[];
}

export const DEFAULT_STALE_DAYS = 180;
export const DEFAULT_STUB_CHARS = 80;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The words of a title in a fixed order, so "Cosmo: notes" and "notes on
 * cosmo" land together. Accents, case, punctuation and filler words are
 * dropped; an empty result means the title says nothing to compare.
 */
export function titleKey(title: string): string {
  const filler = new Set([
    'a',
    'an',
    'the',
    'on',
    'of',
    'and',
    'copy',
    'untitled',
  ]);
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word && !filler.has(word));
  return [...new Set(words)].sort().join(' ');
}

/**
 * The date in an "as of" stamp, as the agents write them: "(as of
 * 2026-10-02)" or a month, "as of 2026-10". Null when the text has none. A
 * month counts from its first day.
 */
export function asOfDate(text: string): { asOf: string; date: Date } | null {
  const match = /\bas of (\d{4})-(\d{2})(?:-(\d{2}))?\b/i.exec(text);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day ?? '1'))
  );
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCMonth() !== Number(month) - 1
  ) {
    return null;
  }
  return { asOf: day ? `${year}-${month}-${day}` : `${year}-${month}`, date };
}

export function notesHealth(
  input: { docs: HealthDoc[]; links: HealthLink[]; blocks: HealthBlock[] },
  options: NotesHealthOptions
): NotesHealthReport {
  const staleDays = options.staleDays ?? DEFAULT_STALE_DAYS;
  const stubChars = options.stubChars ?? DEFAULT_STUB_CHARS;
  const byId = new Map(input.docs.map(doc => [doc.docId, doc]));
  const ref = (doc: HealthDoc): DocRef => ({
    docId: doc.docId,
    title: doc.title || 'Untitled',
  });

  // A note linking to itself doesn't make it reachable.
  const linkedTo = new Set(
    input.links
      .filter(link => link.fromDocId !== link.toDocId)
      .map(link => link.toDocId)
  );
  const orphans = input.docs
    .filter(doc => !doc.journal && !linkedTo.has(doc.docId))
    .map(ref);

  const seenBroken = new Set<string>();
  const brokenLinks: NotesHealthReport['brokenLinks'] = [];
  for (const link of input.links) {
    const from = byId.get(link.fromDocId);
    if (!from || byId.has(link.toDocId)) continue;
    const key = `${link.fromDocId}>${link.toDocId}`;
    if (seenBroken.has(key)) continue;
    seenBroken.add(key);
    brokenLinks.push({
      fromDocId: from.docId,
      fromTitle: from.title || 'Untitled',
      toDocId: link.toDocId,
    });
  }

  const groups = new Map<string, HealthDoc[]>();
  for (const doc of input.docs) {
    if (doc.journal) continue;
    const key = titleKey(doc.title);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  }
  const duplicateTitles = [...groups.values()]
    .filter(docs => docs.length > 1)
    .map(docs => ({ title: docs[0].title, docs: docs.map(ref) }));

  const stubs = input.docs
    .filter(doc => !doc.journal)
    .map(doc => ({ ...ref(doc), chars: doc.summary.trim().length }))
    .filter(doc => doc.chars < stubChars);

  const staleFacts: NotesHealthReport['staleFacts'] = [];
  for (const block of input.blocks) {
    const doc = byId.get(block.docId);
    const stamp = asOfDate(block.text);
    if (!doc || !stamp) continue;
    const ageDays = Math.floor(
      (options.now.getTime() - stamp.date.getTime()) / DAY_MS
    );
    if (ageDays <= staleDays) continue;
    staleFacts.push({
      ...ref(doc),
      blockId: block.blockId,
      text: block.text,
      asOf: stamp.asOf,
      ageDays,
    });
  }
  staleFacts.sort((a, b) => b.ageDays - a.ageDays);

  return { orphans, brokenLinks, duplicateTitles, stubs, staleFacts };
}

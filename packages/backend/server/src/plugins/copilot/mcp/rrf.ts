export type RankedHit = { docId: string; title?: string; text?: string };

export type FusedHit = RankedHit & { score: number; sources: string[] };

/** Standard RRF constant: damps the lead of the top ranks. */
export const RRF_K = 60;

/**
 * Reciprocal rank fusion: each list adds 1 / (k + rank) to a doc's score, so a
 * doc found by several lists beats one found by a single list. Lists are
 * ranked best-first and keyed by `docId`; the first list to name a doc supplies
 * its title and text.
 */
export function fuseRanked(
  lists: { source: string; hits: RankedHit[] }[],
  k = RRF_K
): FusedHit[] {
  const fused = new Map<string, FusedHit>();
  for (const { source, hits } of lists) {
    const seen = new Set<string>();
    hits.forEach(hit => {
      if (seen.has(hit.docId)) return;
      seen.add(hit.docId);
      const gain = 1 / (k + seen.size);
      const entry = fused.get(hit.docId);
      if (entry) {
        entry.score += gain;
        entry.sources.push(source);
        entry.text ??= hit.text;
        entry.title ??= hit.title;
      } else {
        fused.set(hit.docId, { ...hit, score: gain, sources: [source] });
      }
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}

/** Keeps the best hits within an item count and a total character budget. */
export function applyBudget(
  hits: FusedHit[],
  maxItems: number,
  maxChars: number
): FusedHit[] {
  const out: FusedHit[] = [];
  let used = 0;
  for (const hit of hits) {
    if (out.length >= maxItems) break;
    const room = maxChars - used;
    if (room <= 0) break;
    const text =
      hit.text && hit.text.length > room ? hit.text.slice(0, room) : hit.text;
    used += text?.length ?? 0;
    out.push({ ...hit, text });
  }
  return out;
}

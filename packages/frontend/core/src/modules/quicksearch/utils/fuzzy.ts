/** Levenshtein edit distance. Titles are short, so the O(n·m) table is fine. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface TitleCandidate {
  docId: string;
  title: string;
}

export interface TitleSuggestion extends TitleCandidate {
  /** 0 = identical, up toward the threshold. Lower is closer. */
  ratio: number;
}

/**
 * "Did you mean" ranking: the doc titles closest to a query that found nothing,
 * by normalized edit distance. For a single-word query the best matching word
 * within a title also counts, so "anelizing" reaches a note titled "analyzing
 * networks". Tight threshold (≤0.4 edits per char) so only real typo-neighbors
 * surface, and exact matches are dropped (a working search would have found them).
 */
export function suggestSimilarTitles(
  query: string,
  candidates: TitleCandidate[],
  limit = 3
): TitleSuggestion[] {
  const q = normalize(query);
  if (q.length < 3) return [];
  const singleWord = !q.includes(' ');

  const scored: TitleSuggestion[] = [];
  for (const candidate of candidates) {
    const title = normalize(candidate.title);
    if (!title || title === q) continue;

    let ratio = editDistance(q, title) / Math.max(q.length, title.length);
    if (singleWord) {
      for (const word of title.split(' ')) {
        if (!word) continue;
        const wordRatio =
          editDistance(q, word) / Math.max(q.length, word.length);
        if (wordRatio < ratio) ratio = wordRatio;
      }
    }
    if (ratio <= 0.4) scored.push({ ...candidate, ratio });
  }

  scored.sort((a, b) => a.ratio - b.ratio);
  return scored.slice(0, limit);
}

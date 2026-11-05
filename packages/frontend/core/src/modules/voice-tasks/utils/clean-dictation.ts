/**
 * Tidying what a recognizer heard before it lands in a note: hesitations
 * dropped, stutters collapsed, and words the user's own notes spell a certain
 * way ("notes graph" said, "NotesGraph" in their titles) spelled that way.
 */

/** Hesitation sounds. Real words ("like", "so") are left alone: too often meant. */
const HESITATION =
  /(^|[\s,.;:!?])(?:u+h*m+|u+h+|e+r+m*|a+h+|h+m+|m+h*m+)(?=$|[\s,.;:!?])[,.]?/gi;

/** "you know" / "I mean" set off by commas, as a recognizer that punctuates writes them. */
const PARENTHETICAL_FILLER = /(^|,)\s*(?:you know|i mean)\s*(?=,|$)/gi;

/** Words people do say twice on purpose ("that that", "no no"). */
const REPEAT_OK = new Set(['that', 'had', 'ha', 'no', 'bye', 'very', 'really']);

export function removeFillers(text: string): string {
  const out = text
    .replace(HESITATION, '$1')
    .replace(PARENTHETICAL_FILLER, '$1')
    .replace(/\b([\p{L}']+)(?:\s+\1\b)+/giu, (match, word: string) =>
      REPEAT_OK.has(word.toLowerCase()) ? match : word
    )
    // What the removals leave behind: doubled spaces and orphaned commas.
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/(^|[.!?]\s*)[,;:]\s*/g, '$1')
    .replace(/,(?=[.!?]|$)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return capitalizeSentences(out, text);
}

/**
 * A sentence whose first word was a filler starts with what came after it.
 * Only for recognizers that capitalize at all (the text started with a
 * capital); Android's system recognizer writes everything in lowercase.
 */
function capitalizeSentences(out: string, original: string): string {
  if (original.trim() === out || !/^\P{L}*\p{Lu}/u.test(original)) return out;
  return out.replace(
    /(^|[.!?]\s+)(\p{Ll})/gu,
    (_m, lead: string, c: string) => lead + c.toUpperCase()
  );
}

/** A word or phrase from the user's notes, with the spelling to keep. */
export interface VocabularyTerm {
  term: string;
  /** Lowercase letters and digits only: what it sounds like, spacing aside. */
  key: string;
}

const keyOf = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Whether a word is spelled in a way a recognizer won't guess: capitals inside
 * it (NotesGraph, iPhone) or an acronym (PR, TTS). Ordinary words are left
 * out, or every "work" would turn into a tag.
 */
function isDistinctive(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return false;
  if (/^\p{Lu}+$/u.test(letters)) return true;
  return /\p{Ll}\p{Lu}/u.test(word);
}

/** The terms in note titles and tag names worth spelling the user's way. */
export function buildVocabulary(
  phrases: Iterable<string>,
  limit = 2000
): VocabularyTerm[] {
  const byKey = new Map<string, VocabularyTerm>();
  for (const phrase of phrases) {
    for (const raw of phrase.split(/[\s,;:()[\]{}"/|]+/)) {
      const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      // Ticket keys and dates ("PERSONAL-217") aren't things anyone says as written.
      if (/\p{N}/u.test(word) || !isDistinctive(word)) continue;
      const key = keyOf(word);
      if (key.length < 2 || byKey.has(key)) continue;
      byKey.set(key, { term: word, key });
      if (byKey.size >= limit) return [...byKey.values()];
    }
  }
  return [...byKey.values()];
}

/**
 * Edit distance counting a swap of neighbours as one slip ("flete" for
 * "fleet"), or Infinity once it is sure to pass `max`.
 */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return Infinity;
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    d.push([i]);
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        d[0][j] = j;
        continue;
      }
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
      best = Math.min(best, v);
    }
    if (i > 0 && best > max) return Infinity;
  }
  const result = d[a.length][b.length];
  return result <= max ? result : Infinity;
}

/** How many slips a heard phrase may have and still be taken for a term. */
function allowedSlips(termKey: string, words: number): number {
  if (termKey.length >= 10) return 2;
  // One slip in a single short word is usually a different word.
  if (termKey.length >= 6 && (words > 1 || termKey.length >= 8)) return 1;
  return 0;
}

const MAX_PHRASE_WORDS = 3;

interface Word {
  lead: string;
  core: string;
  trail: string;
}

/**
 * The term the words from `i` on stand for, and how many words it takes. An
 * exact match wins; otherwise the closest near miss, on the fewest words.
 */
function matchAt(
  words: readonly Word[],
  i: number,
  vocabulary: readonly VocabularyTerm[],
  exact: ReadonlyMap<string, VocabularyTerm>
): { term: string; n: number } | null {
  const runs: { n: number; key: string }[] = [];
  for (let n = 1; n <= Math.min(MAX_PHRASE_WORDS, words.length - i); n++) {
    const run = words.slice(i, i + n);
    // A phrase broken by punctuation is two thoughts, not one term.
    const broken = run.some(
      (w, k) => !w.core || (k > 0 && w.lead) || (k < n - 1 && w.trail)
    );
    if (broken) break;
    runs.push({ n, key: keyOf(run.map(w => w.core).join('')) });
  }

  for (const { n, key } of [...runs].reverse()) {
    const match = exact.get(key);
    if (!match) continue;
    // Short acronyms are often words too ("IT", "US"): only take them
    // when spelled out letter by letter ("t t s").
    const spelledOut =
      n > 1 && words.slice(i, i + n).every(w => w.core.length === 1);
    if (isShortAcronym(match.term) && !spelledOut) continue;
    return { term: match.term, n };
  }

  let best: { term: string; n: number; d: number } | null = null;
  for (const { n, key } of runs) {
    if (key.length < 6) continue;
    for (const v of vocabulary) {
      const max = allowedSlips(v.key, n);
      if (!max || v.key[0] !== key[0]) continue;
      const d = distance(key, v.key, max);
      if (d < (best?.d ?? Infinity)) best = { term: v.term, n, d };
    }
  }
  return best;
}

/**
 * Respell runs of up to three words that sound like a vocabulary term, e.g.
 * "the notes graph app" becomes "the NotesGraph app". Near misses only count
 * for long terms with the same first letter, so short common words are never
 * rewritten into jargon.
 */
export function applyVocabulary(
  text: string,
  vocabulary: readonly VocabularyTerm[]
): string {
  if (!vocabulary.length || !text.trim()) return text;
  const exact = new Map(vocabulary.map(v => [v.key, v]));
  // Alternates word, whitespace, word, ...
  const parts = text.split(/(\s+)/);
  const words: Word[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su.exec(parts[i]);
    words.push({ lead: m?.[1] ?? '', core: m?.[2] ?? '', trail: m?.[3] ?? '' });
  }
  const spaceBefore = (i: number) => (i === 0 ? '' : parts[i * 2 - 1]);

  let out = '';
  for (let i = 0; i < words.length; ) {
    const match = matchAt(words, i, vocabulary, exact);
    if (match) {
      const last = words[i + match.n - 1];
      out += spaceBefore(i) + words[i].lead + match.term + last.trail;
      i += match.n;
    } else {
      const w = words[i];
      out += spaceBefore(i) + w.lead + w.core + w.trail;
      i++;
    }
  }
  return out;
}

const isShortAcronym = (term: string) =>
  term.length <= 4 && /^\p{Lu}+$/u.test(term);

/** A finished utterance, made ready to write into a note. */
export function cleanDictation(
  text: string,
  vocabulary: readonly VocabularyTerm[] = []
): string {
  return applyVocabulary(removeFillers(text), vocabulary);
}

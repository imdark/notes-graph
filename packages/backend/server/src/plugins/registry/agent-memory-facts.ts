/**
 * The facts in the "Agent memory" notes, as plain data: reading them out of a
 * subject note's markdown, applying an extraction's creates and deletes to
 * one, and choosing which to remind a run of. No I/O, so it is tested on
 * strings; agent-memory.ts does the reading and writing.
 *
 * A fact is a line of a subject note, written the way the agents' own
 * instruction asks (agent-profiles.ts): plainly, and dated, e.g.
 * "- Cosmo is the user's son, 7 years old (as of 2026-10-02)". Anything else
 * a person adds to the note is a fact too: the note is theirs to edit.
 */

export const MEMORY_ROOT_TITLE = 'Agent memory';

export interface MemoryFact {
  subject: string;
  text: string;
  /** From "(as of YYYY-MM-DD)", when the line has one. */
  date: string | null;
}

export interface MemoryOp {
  subject: string;
  fact: string;
}

export interface MemoryOps {
  create: MemoryOp[];
  delete: MemoryOp[];
}

const AS_OF = /\s*\(as of (\d{4}-\d{2}-\d{2})\)\s*\.?\s*$/i;
const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX-]\]\s+)?/;
const STAMP = /^>\s*Edited via MCP by /;
const ONLY_LINK = /^\[[^\]]*\]\([^)]*\)$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;

const MAX_OPS = 20;
const MAX_SUBJECT = 80;
const MAX_FACT = 300;

function oneLine(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** A note line as a fact's text, or null for a line that isn't one. */
export function factFromLine(line: string): string | null {
  const trimmed = line.trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('>') ||
    trimmed.startsWith('```') ||
    RULE.test(trimmed)
  ) {
    return null;
  }
  const text = trimmed.replace(LIST_MARKER, '').trim();
  // A line that is only a link files another note; it says nothing itself.
  if (!text || ONLY_LINK.test(text)) return null;
  return text;
}

export function parseFacts(subject: string, markdown: string): MemoryFact[] {
  const facts: MemoryFact[] = [];
  for (const line of markdown.split('\n')) {
    const text = factFromLine(line);
    if (text)
      facts.push({ subject, text, date: AS_OF.exec(text)?.[1] ?? null });
  }
  return facts;
}

/**
 * What two wordings of one fact share: case, date, markup, trailing
 * punctuation and a leading "Subject:" aside. An agent writes "Cosmo: the
 * user's son" into the note titled Cosmo; the extraction says "the user's son".
 */
export function factKey(text: string, subject = ''): string {
  let key = text
    .replace(LIST_MARKER, '')
    .replace(AS_OF, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const prefix = `${subject.trim().toLowerCase()}:`;
  if (subject && key.startsWith(prefix)) key = key.slice(prefix.length).trim();
  return key.replace(/[\s.;,!]+$/, '');
}

/** The ids of the notes a note links to, in order, from its markdown. */
export function linkedDocIds(markdown: string, selfId?: string): string[] {
  const ids = new Set<string>();
  const link = /\]\((?:\/workspace\/[^/)\s]+\/|LinkedPage:)([\w-]+)/g;
  for (const match of markdown.matchAll(link)) {
    if (match[1] !== selfId) ids.add(match[1]);
  }
  return [...ids];
}

/**
 * An extraction's output, made safe to write: trimmed one-line strings,
 * capped, nothing empty, nothing filed under the memory note itself.
 */
export function parseExtraction(value: unknown): MemoryOps {
  const ops = (list: unknown): MemoryOp[] =>
    (Array.isArray(list) ? list : [])
      .map(item => ({
        subject: oneLine(item?.subject, MAX_SUBJECT),
        fact: oneLine(item?.fact, MAX_FACT),
      }))
      .filter(
        op =>
          op.subject &&
          op.fact &&
          op.subject.toLowerCase() !== MEMORY_ROOT_TITLE.toLowerCase()
      )
      .slice(0, MAX_OPS);
  const record = (value ?? {}) as Record<string, unknown>;
  return { create: ops(record.create), delete: ops(record.delete) };
}

/** Ops by subject, case-insensitively; the first spelling names the note. */
export function groupBySubject(
  ops: MemoryOps
): Map<string, { subject: string; create: string[]; delete: string[] }> {
  const groups = new Map<
    string,
    { subject: string; create: string[]; delete: string[] }
  >();
  const add = (op: MemoryOp, kind: 'create' | 'delete') => {
    const key = op.subject.toLowerCase();
    const group = groups.get(key) ?? {
      subject: op.subject,
      create: [],
      delete: [],
    };
    group[kind].push(op.fact);
    groups.set(key, group);
  };
  ops.delete.forEach(op => add(op, 'delete'));
  ops.create.forEach(op => add(op, 'create'));
  return groups;
}

/**
 * A subject note's markdown with `remove` taken out and `add` appended, each
 * dated `today`. A fact already there is not added twice, so an update is a
 * delete of the old wording and a create of the new. New lines go below the
 * facts and above a trailing "Edited via MCP" stamp.
 */
export function applyMemoryOps(
  markdown: string,
  subject: string,
  ops: { create: string[]; delete: string[] },
  today: string
): { markdown: string; created: number; deleted: number } {
  const drop = new Set(
    ops.delete.map(fact => factKey(fact, subject)).filter(Boolean)
  );
  let deleted = 0;
  const kept = markdown.split('\n').filter(line => {
    const fact = factFromLine(line);
    if (fact && drop.has(factKey(fact, subject))) {
      deleted++;
      return false;
    }
    return true;
  });

  const present = new Set(
    kept
      .map(factFromLine)
      .filter((fact): fact is string => !!fact)
      .map(fact => factKey(fact, subject))
  );
  const added: string[] = [];
  for (const raw of ops.create) {
    const fact = oneLine(raw, MAX_FACT);
    const key = factKey(fact, subject);
    if (!key || present.has(key)) continue;
    present.add(key);
    added.push(
      `- ${AS_OF.test(fact) ? fact : `${fact.replace(/[\s.]+$/, '')} (as of ${today})`}`
    );
  }
  if (!added.length && !deleted) return { markdown, created: 0, deleted: 0 };

  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  let at = kept.length;
  if (at && STAMP.test(kept[at - 1].trim())) {
    at--;
    while (at && !kept[at - 1].trim()) at--;
  }
  const head = kept.slice(0, at);
  const tail = kept.slice(at).filter(line => line.trim());
  const last = head[head.length - 1]?.trim() ?? '';
  // Join the list the facts are already in; otherwise start one.
  const gap = head.length && !LIST_MARKER.test(last) ? [''] : [];
  const lines = [
    ...head,
    ...gap,
    ...added,
    ...(tail.length ? ['', ...tail] : []),
  ];
  return { markdown: `${lines.join('\n')}\n`, created: added.length, deleted };
}

const STOPWORDS = new Set(
  (
    'the and for with that this from into about what which when where who how ' +
    'are was were been have has had not but you your they them their our out ' +
    'can could should would will just also than then there here some any all ' +
    'one two get got make made like want need find help please user users'
  ).split(' ')
);

function words(text: string): Set<string> {
  const found = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length >= 3 && !STOPWORDS.has(word)) found.add(word);
  }
  return found;
}

/**
 * The facts worth handing a run that is about `query`: those sharing words
 * with it (a subject named in the task counts double), then the most recent,
 * up to `max` facts and `maxChars` of text.
 */
export function recallFacts(
  facts: MemoryFact[],
  query: string,
  { max = 20, maxChars = 2000 }: { max?: number; maxChars?: number } = {}
): MemoryFact[] {
  const asked = words(query);
  const scored = facts.map((fact, index) => {
    let score = 0;
    for (const word of words(fact.text)) if (asked.has(word)) score++;
    for (const word of words(fact.subject)) if (asked.has(word)) score += 2;
    return { fact, index, score };
  });
  // Dated facts newest first; undated ones after, later lines first.
  const recent = [...scored].sort(
    (a, b) =>
      (b.fact.date ?? '').localeCompare(a.fact.date ?? '') || b.index - a.index
  );
  const relevant = scored
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index);

  const picked: MemoryFact[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const { fact } of [...relevant, ...recent]) {
    if (picked.length >= max) break;
    const key = `${fact.subject.toLowerCase()}\n${factKey(fact.text, fact.subject)}`;
    if (seen.has(key)) continue;
    const line = recallLine(fact);
    if (chars + line.length > maxChars) continue;
    seen.add(key);
    chars += line.length + 1;
    picked.push(fact);
  }
  return picked;
}

function recallLine(fact: MemoryFact): string {
  const text = fact.text;
  return text.toLowerCase().startsWith(fact.subject.toLowerCase())
    ? `- ${text}`
    : `- ${fact.subject}: ${text}`;
}

/** The system prompt's section for recalled facts; empty for none. */
export function recallSection(facts: MemoryFact[]): string {
  if (!facts.length) return '';
  return (
    `What you already know about the user, from their "${MEMORY_ROOT_TITLE}" ` +
    `notes. Don't look these up or ask them again; if one turns out wrong or ` +
    `out of date, correct it in its note. There may be more in the notes.\n` +
    `${facts.map(recallLine).join('\n')}\n`
  );
}

export interface ExtractionInput {
  today: string;
  instructions: string;
  title: string | null;
  questions: { text: string; answer: string }[];
  result: string | null;
  log: string;
  facts: MemoryFact[];
}

const MAX_INSTRUCTIONS = 4_000;
const MAX_RESULT = 4_000;
const MAX_LOG = 12_000;
const MAX_KNOWN = 6_000;

/** What the extraction prompt reads about one run, bounded. */
export function extractionContent(input: ExtractionInput): string {
  const tail = (text: string, max: number) =>
    text.length > max ? `…${text.slice(text.length - max)}` : text;
  const known = input.facts.map(recallLine).join('\n');
  const sections = [
    `Today: ${input.today}`,
    `## What the user asked the agent to do\n${
      input.title ? `${input.title}\n\n` : ''
    }${input.instructions.slice(0, MAX_INSTRUCTIONS)}`,
    `## The agent's questions and the user's answers\n${
      input.questions.length
        ? input.questions.map(q => `Q: ${q.text}\nA: ${q.answer}`).join('\n\n')
        : '(none)'
    }`,
    `## The agent's final answer\n${(input.result ?? '').slice(0, MAX_RESULT) || '(none)'}`,
    `## End of the run's transcript\n${tail(input.log, MAX_LOG) || '(empty)'}`,
    `## Facts already in memory\n${tail(known, MAX_KNOWN) || '(none yet)'}`,
  ];
  return sections.join('\n\n');
}

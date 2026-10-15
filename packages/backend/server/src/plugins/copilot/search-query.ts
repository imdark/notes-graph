/**
 * Search query filter syntax, shared by the copilot `doc_semantic_search`
 * tool and the MCP `semantic_search` / `keyword_search` tools.
 *
 * Kept free of server imports: the frontend quick search carries an identical
 * copy at packages/frontend/core/src/modules/docs-search/utils/search-query.ts
 * (no package is shared by both sides), so change both together.
 *
 *   tag:work            doc has the inline #work tag
 *   prop:status:done    doc has the #status:done property
 *   doc:"Weekly notes"  doc title contains the text, or doc:<docId>
 *   dt>=2026-01-01      doc updated on/after the day (also dt<= dt> dt< dt=)
 *   ct>=2026-01-01      same, on the doc's created date
 *   +"word" / -"word"   the text must / must not contain the word or phrase
 *
 * Values may be quoted to include spaces. Dates are whole UTC days. Anything
 * else is the search text.
 */

export type SearchDateField = 'updated' | 'created';
export type SearchDateOp = '>=' | '<=' | '>' | '<' | '=';

export interface SearchDateFilter {
  field: SearchDateField;
  op: SearchDateOp;
  /** YYYY-MM-DD */
  date: string;
}

export interface SearchQueryFilters {
  /** The query with every filter token removed. */
  text: string;
  tags: string[];
  /** `key:value` pairs. */
  props: string[];
  /** Doc titles or ids; a hit must belong to any one of them. */
  docs: string[];
  dates: SearchDateFilter[];
  include: string[];
  exclude: string[];
}

/** A half-open millisecond range: `from` inclusive, `to` exclusive. */
export interface SearchDateRange {
  from?: number;
  to?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FIELD_TOKEN = /^(tag|prop|doc):(.+)$/i;
const DATE_TOKEN = /^(dt|ct)(>=|<=|>|<|=)(\d{4}-\d{2}-\d{2})$/i;
const WORD_TOKEN = /^([+-])(.+)$/;

/** Split on whitespace, keeping `"quoted parts"` (anywhere in a token) whole. */
function tokenize(query: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of query) {
    if (char === '"') quoted = !quoted;
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed.replace(/^"|"$/g, '').trim();
}

function dayStart(date: string): number | undefined {
  const time = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(time)) return undefined;
  // reject dates Date.parse rolls over, e.g. 2026-02-31
  if (new Date(time).toISOString().slice(0, 10) !== date) return undefined;
  return time;
}

export function parseSearchQuery(query: string): SearchQueryFilters {
  const filters: SearchQueryFilters = {
    text: '',
    tags: [],
    props: [],
    docs: [],
    dates: [],
    include: [],
    exclude: [],
  };
  const text: string[] = [];

  for (const token of tokenize(query)) {
    const field = FIELD_TOKEN.exec(token);
    if (field) {
      const value = unquote(field[2]);
      const kind = field[1].toLowerCase();
      if (value && kind === 'tag') {
        filters.tags.push(value.replace(/^#/, '').toLowerCase());
        continue;
      }
      if (value && kind === 'prop' && /^[^:]+:.+/.test(value)) {
        filters.props.push(value.replace(/^#/, '').toLowerCase());
        continue;
      }
      if (value && kind === 'doc') {
        filters.docs.push(value);
        continue;
      }
    }

    const date = DATE_TOKEN.exec(token);
    if (date && dayStart(date[3]) !== undefined) {
      filters.dates.push({
        field: date[1].toLowerCase() === 'ct' ? 'created' : 'updated',
        op: date[2] as SearchDateOp,
        date: date[3],
      });
      continue;
    }

    const word = WORD_TOKEN.exec(token);
    if (word) {
      const value = unquote(word[2]);
      if (value) {
        (word[1] === '+' ? filters.include : filters.exclude).push(value);
        continue;
      }
    }

    text.push(token);
  }

  filters.text = text.join(' ').trim();
  return filters;
}

/** Filters that narrow which docs may match (resolved to a doc id set). */
export function hasScopeFilters(filters: SearchQueryFilters): boolean {
  return (
    filters.tags.length > 0 ||
    filters.props.length > 0 ||
    filters.docs.length > 0 ||
    filters.dates.length > 0
  );
}

export function hasSearchFilters(filters: SearchQueryFilters): boolean {
  return (
    hasScopeFilters(filters) ||
    filters.include.length > 0 ||
    filters.exclude.length > 0
  );
}

/**
 * The text to search with: the query minus its filters, or the must-contain
 * words when only filters were given.
 */
export function searchText(filters: SearchQueryFilters): string {
  return filters.text || filters.include.join(' ');
}

/** Combine the date filters on one field into a single range. */
export function dateFilterRange(
  dates: SearchDateFilter[],
  field: SearchDateField
): SearchDateRange | undefined {
  let range: SearchDateRange | undefined;
  for (const filter of dates) {
    if (filter.field !== field) continue;
    const start = dayStart(filter.date);
    if (start === undefined) continue;
    const end = start + DAY_MS;
    let from: number | undefined;
    let to: number | undefined;
    switch (filter.op) {
      case '>=':
        from = start;
        break;
      case '>':
        from = end;
        break;
      case '<=':
        to = end;
        break;
      case '<':
        to = start;
        break;
      case '=':
        from = start;
        to = end;
        break;
    }
    range ??= {};
    if (from !== undefined) range.from = Math.max(range.from ?? from, from);
    if (to !== undefined) range.to = Math.min(range.to ?? to, to);
  }
  return range;
}

function inRange(range: SearchDateRange | undefined, time?: number | null) {
  if (!range) return true;
  if (time === undefined || time === null || Number.isNaN(time)) return false;
  if (range.from !== undefined && time < range.from) return false;
  if (range.to !== undefined && time >= range.to) return false;
  return true;
}

export function matchesDateFilters(
  dates: SearchDateFilter[],
  times: { createdAt?: number | null; updatedAt?: number | null }
): boolean {
  return (
    inRange(dateFilterRange(dates, 'updated'), times.updatedAt) &&
    inRange(dateFilterRange(dates, 'created'), times.createdAt)
  );
}

/** Case-insensitive: every `+` word present, no `-` word present. */
export function matchesWordFilters(
  filters: Pick<SearchQueryFilters, 'include' | 'exclude'>,
  text: string
): boolean {
  const haystack = text.toLowerCase();
  return (
    filters.include.every(word => haystack.includes(word.toLowerCase())) &&
    !filters.exclude.some(word => haystack.includes(word.toLowerCase()))
  );
}

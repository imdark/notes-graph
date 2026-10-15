import type { Models, WorkspaceEmbeddingScope } from '../../models';
import type { IndexerService } from '../indexer';
import { SearchTable } from '../indexer/tables';
import { SearchQueryOccur, SearchQueryType } from '../indexer/types';
import {
  dateFilterRange,
  matchesDateFilters,
  type SearchDateRange,
  type SearchQueryFilters,
} from './search-query';

/** How many more candidates to fetch when results are filtered afterwards. */
export const SEARCH_FILTER_OVERFETCH = 4;
/** Upper bound on index rows read when resolving one filter to doc ids. */
const FILTER_SCAN_LIMIT = 10000;

/**
 * Multi-value index fields come back as a plain string, an array, or (from
 * the Manticore write path) a JSON-stringified array — normalize to a
 * string list.
 */
export function tokenList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value !== 'string' || !value) return [];
  if (value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === 'string'
        );
      }
    } catch {
      // fall through — treat as a single token
    }
  }
  return [value];
}

function intersect(current: Set<string> | undefined, next: Set<string>) {
  if (!current) return next;
  return new Set([...current].filter(id => next.has(id)));
}

function toDates(range: SearchDateRange | undefined) {
  if (!range) return undefined;
  return {
    from: range.from === undefined ? undefined : new Date(range.from),
    to: range.to === undefined ? undefined : new Date(range.to),
  };
}

type SearchFilterDeps = {
  models: Models;
  indexer?: IndexerService;
};

/**
 * Doc ids that have a block matching `field` = `value`. Index matching can be
 * tokenized, so `verify` re-checks each hit verbatim.
 */
async function docIdsFromBlocks(
  indexer: IndexerService,
  workspaceId: string,
  field: string,
  value: string,
  verify: (fieldValue: unknown) => boolean
) {
  const result = await indexer.search({
    table: SearchTable.block,
    query: {
      type: SearchQueryType.boolean,
      occur: SearchQueryOccur.must,
      queries: [
        {
          type: SearchQueryType.match,
          field: 'workspaceId',
          match: workspaceId,
        },
        { type: SearchQueryType.match, field, match: value },
      ],
    },
    options: {
      fields: ['docId', field],
      pagination: { limit: FILTER_SCAN_LIMIT },
    },
  });
  const docIds = new Set<string>();
  for (const node of result.nodes) {
    const docId = tokenList(node.fields.docId)[0];
    if (docId && verify(node.fields[field])) docIds.add(docId);
  }
  return docIds;
}

function requireIndexer(indexer: IndexerService | undefined) {
  if (!indexer) {
    throw new Error(
      'tag: and prop: filters need the search indexer, which is disabled on this server.'
    );
  }
  return indexer;
}

/**
 * Resolve the tag/prop/doc/date filters of a query to an embedding search
 * scope, or undefined when the query has none of them.
 */
export async function resolveSearchScope(
  { models, indexer }: SearchFilterDeps,
  workspaceId: string,
  filters: SearchQueryFilters
): Promise<WorkspaceEmbeddingScope | undefined> {
  let docIds: Set<string> | undefined;

  for (const tag of filters.tags) {
    const ids = await docIdsFromBlocks(
      requireIndexer(indexer),
      workspaceId,
      'tags',
      tag,
      value => tokenList(value).includes(tag)
    );
    docIds = intersect(docIds, ids);
  }
  for (const prop of filters.props) {
    const ids = await docIdsFromBlocks(
      requireIndexer(indexer),
      workspaceId,
      'props',
      prop,
      value => tokenList(value).includes(prop)
    );
    docIds = intersect(docIds, ids);
  }
  if (filters.docs.length) {
    // a hit belongs to one doc, so several doc: filters mean "any of them"
    const ids = new Set<string>();
    for (const doc of filters.docs) {
      ids.add(doc);
      for (const id of await models.doc.findIdsByTitleMatch(workspaceId, doc)) {
        ids.add(id);
      }
    }
    docIds = intersect(docIds, ids);
  }

  const createdAt = toDates(dateFilterRange(filters.dates, 'created'));
  const updatedAt = toDates(dateFilterRange(filters.dates, 'updated'));
  if (!docIds && !createdAt && !updatedAt) return undefined;
  return {
    docIds: docIds ? [...docIds] : undefined,
    createdAt,
    updatedAt,
  };
}

/**
 * Doc-level `+word` / `-word`: docs with a block containing the word.
 * Returns the docs every `+` word appears in (undefined without `+` words)
 * and the docs any `-` word appears in.
 */
export async function resolveWordDocIds(
  { indexer }: SearchFilterDeps,
  workspaceId: string,
  filters: Pick<SearchQueryFilters, 'include' | 'exclude'>
) {
  const containing = (word: string) =>
    docIdsFromBlocks(
      requireIndexer(indexer),
      workspaceId,
      'content',
      word,
      value =>
        tokenList(value).some(text =>
          text.toLowerCase().includes(word.toLowerCase())
        )
    );

  let include: Set<string> | undefined;
  for (const word of filters.include) {
    include = intersect(include, await containing(word));
  }
  const exclude = new Set<string>();
  for (const word of filters.exclude) {
    for (const id of await containing(word)) exclude.add(id);
  }
  return { include, exclude };
}

/** Of `docIds`, those whose snapshot dates pass the query's date filters. */
export async function filterDocIdsByDates(
  models: Models,
  workspaceId: string,
  docIds: string[],
  filters: Pick<SearchQueryFilters, 'dates'>
) {
  if (!filters.dates.length) return new Set(docIds);
  const authors = await models.doc.findAuthors(
    docIds.map(docId => ({ workspaceId, docId }))
  );
  return new Set(
    authors.flatMap(doc =>
      doc &&
      matchesDateFilters(filters.dates, {
        createdAt: doc.createdAt?.getTime(),
        updatedAt: doc.updatedAt?.getTime(),
      })
        ? [doc.id]
        : []
    )
  );
}

export const SEARCH_FILTER_SYNTAX =
  'The query may include filters, combined with AND: tag:work (doc has #work), prop:status:done (doc has #status:done), doc:"Title" or doc:<docId> (only that doc; repeat for any of several), dt>=YYYY-MM-DD / dt<= / dt> / dt< / dt= (doc last updated, whole UTC days; ct… for created), +"word" (result must contain) and -"word" (must not contain). Quote values with spaces. The rest of the query is the search text.';

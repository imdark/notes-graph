import type { ReferenceParams } from '@blocksuite/notesgraph/model';
import { toDocSearchParams } from '@notesgraph/core/modules/navigation';
import { fromPromise, LiveData, Service } from '@notesgraph/infra';
import type {
  IndexerPreferOptions,
  IndexerSyncState,
} from '@notesgraph/nbstore';
import { isEmpty, omit } from 'lodash-es';
import {
  combineLatest,
  distinctUntilChanged,
  map,
  type Observable,
  of,
  switchMap,
} from 'rxjs';
import { z } from 'zod';

import { normalizeSearchText } from '../../../utils/normalize-search-text';
import type { DocsService } from '../../doc/services/docs';
import type { WorkspaceService } from '../../workspace';
import {
  hasSearchFilters,
  matchesDateFilters,
  type SearchQueryFilters,
} from '../utils/search-query';

export interface DocSearchResult {
  docId: string;
  title: string;
  score: number;
  blockId?: string;
  blockContent?: string;
}

/** Docs one search returns. */
const SEARCH_LIMIT = 50;
/** Candidates fetched when results are filtered afterwards. */
const FILTERED_SEARCH_LIMIT = 200;
/** Upper bound on index rows read when resolving one filter to doc ids. */
const FILTER_SCAN_LIMIT = 10000;

/**
 * Multi-value index fields come back as a string, an array, or a
 * JSON-stringified array; normalize to a string list.
 */
function indexTokens(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value !== 'string' || !value) return [];
  if (value.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === 'string'
        );
      }
    } catch {
      // not JSON: a single token
    }
  }
  return [value];
}

export class DocsSearchService extends Service {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly docsService: DocsService
  ) {
    super();
  }

  get indexer() {
    return this.workspaceService.workspace.engine.indexer;
  }

  readonly indexerState$ = LiveData.from(this.indexer.state$, {
    indexing: 0,
    errorMessage: null,
  } as IndexerSyncState);

  searchTitle$(query: string) {
    return this.indexer
      .search$(
        'doc',
        {
          type: 'match',
          field: 'title',
          match: query,
        },
        {
          pagination: {
            skip: 0,
            limit: Infinity,
          },
        }
      )
      .pipe(
        map(({ nodes }) => {
          return nodes.map(node => node.id);
        })
      );
  }

  /**
   * Incomplete to-do checkbox items across the workspace (indexed `todoStatus`).
   * Returns the true total count plus the first `limit` items for display.
   */
  watchTodos(limit = 500) {
    const first = (v: string | string[] | undefined) =>
      Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
    return this.indexer
      .search$(
        'block',
        { type: 'match', field: 'todoStatus', match: 'todo' },
        {
          pagination: { limit, skip: 0 },
          fields: ['docId', 'blockId', 'content', 'todoTrail'],
          prefer: 'local',
        }
      )
      .pipe(
        map(result => ({
          total: result.pagination.count,
          items: result.nodes.map(node => ({
            docId: first(node.fields.docId),
            blockId: first(node.fields.blockId),
            text: normalizeSearchText(first(node.fields.content)),
            trail: first(node.fields.todoTrail) || undefined,
          })),
        }))
      );
  }

  /**
   * Full-text doc search. With `filters` (from `parseSearchQuery`), `query`
   * is the query's remaining text and results are narrowed to docs with the
   * tags/props, the doc: titles/ids, the date ranges and the +/- words; with
   * no text left, lists the docs matching the filters, recently updated first.
   */
  search$(
    query: string,
    prefer: IndexerPreferOptions = 'remote',
    filters?: SearchQueryFilters
  ): Observable<DocSearchResult[]> {
    if (!filters || !hasSearchFilters(filters)) {
      return this.searchText$(query, prefer, SEARCH_LIMIT);
    }
    return this.filterDocIds$(filters, prefer).pipe(
      switchMap(({ allowed, excluded }) => {
        if (allowed?.size === 0) return of([]);
        const results$ = query
          ? this.searchText$(query, prefer, FILTERED_SEARCH_LIMIT)
          : of(this.listDocs(allowed));
        return results$.pipe(
          map(results =>
            results
              .filter(result => {
                if (allowed && !allowed.has(result.docId)) return false;
                if (excluded.has(result.docId)) return false;
                if (!filters.dates.length) return true;
                const record = this.docsService.list.doc$(result.docId).value;
                return (
                  !!record &&
                  matchesDateFilters(filters.dates, {
                    createdAt: record.createdAt$.value,
                    updatedAt: record.updatedAt$.value,
                  })
                );
              })
              .slice(0, SEARCH_LIMIT)
          )
        );
      })
    );
  }

  /** Non-trashed docs (of `allowed`, if given), recently updated first. */
  private listDocs(allowed?: Set<string>): DocSearchResult[] {
    return this.docsService.list.docs$.value
      .filter(
        record => !record.trash$.value && (!allowed || allowed.has(record.id))
      )
      .toSorted((a, b) => (b.updatedAt$.value ?? 0) - (a.updatedAt$.value ?? 0))
      .map(record => ({
        docId: record.id,
        title: record.title$.value,
        score: 0,
      }));
  }

  /**
   * Docs with a block whose `field` matches `value`; `verify` re-checks each
   * hit, since index matching can be tokenized.
   */
  private docIdsWithBlock$(
    field: 'tags' | 'props' | 'content',
    value: string,
    prefer: IndexerPreferOptions,
    verify: (tokens: string[]) => boolean
  ) {
    return this.indexer
      .search$(
        'block',
        { type: 'match', field, match: value },
        {
          fields: ['docId', field],
          pagination: { limit: FILTER_SCAN_LIMIT, skip: 0 },
          prefer,
        }
      )
      .pipe(
        map(({ nodes }) => {
          const docIds = new Set<string>();
          for (const node of nodes) {
            const docId = indexTokens(node.fields.docId)[0];
            if (docId && verify(indexTokens(node.fields[field]))) {
              docIds.add(docId);
            }
          }
          return docIds;
        })
      );
  }

  /** The `key:value` props found in each of `docIds`, from the index. */
  docProps$(
    docIds: string[],
    prefer: IndexerPreferOptions = 'remote'
  ): Observable<Map<string, string[]>> {
    if (!docIds.length) return of(new Map());
    return this.indexer
      .search$(
        'block',
        {
          type: 'boolean',
          occur: 'must',
          queries: [
            {
              type: 'boolean',
              occur: 'should',
              queries: docIds.map(docId => ({
                type: 'match' as const,
                field: 'docId' as const,
                match: docId,
              })),
            },
            { type: 'exists', field: 'props' },
          ],
        },
        {
          fields: ['docId', 'props'],
          pagination: { limit: FILTER_SCAN_LIMIT, skip: 0 },
          prefer,
        }
      )
      .pipe(
        map(({ nodes }) => {
          const wanted = new Set(docIds);
          const props = new Map<string, string[]>();
          for (const node of nodes) {
            const docId = indexTokens(node.fields.docId)[0];
            if (!docId || !wanted.has(docId)) continue;
            props.set(docId, [
              ...(props.get(docId) ?? []),
              ...indexTokens(node.fields.props),
            ]);
          }
          return props;
        })
      );
  }

  /**
   * The docs a filtered query may return (undefined: no restriction), and
   * the docs a `-word` rules out.
   */
  private filterDocIds$(
    filters: SearchQueryFilters,
    prefer: IndexerPreferOptions
  ): Observable<{ allowed?: Set<string>; excluded: Set<string> }> {
    const containing = (word: string) => {
      const needle = word.toLowerCase();
      return this.docIdsWithBlock$('content', word, prefer, tokens =>
        tokens.some(text => text.toLowerCase().includes(needle))
      );
    };
    const required$ = [
      ...filters.tags.map(tag =>
        this.docIdsWithBlock$('tags', tag, prefer, tokens =>
          tokens.includes(tag)
        )
      ),
      ...filters.props.map(prop =>
        this.docIdsWithBlock$('props', prop, prefer, tokens =>
          tokens.includes(prop)
        )
      ),
      ...filters.include.map(containing),
    ];
    const excluded$ = filters.exclude.map(containing);

    let docs: Set<string> | undefined;
    if (filters.docs.length) {
      const needles = filters.docs.map(doc => doc.toLowerCase());
      docs = new Set(
        this.docsService.list.docs$.value
          .filter(record => {
            const title = record.title$.value.toLowerCase();
            return filters.docs.some(
              (doc, i) => record.id === doc || title.includes(needles[i])
            );
          })
          .map(record => record.id)
      );
    }

    return combineLatest([
      required$.length ? combineLatest(required$) : of([]),
      excluded$.length ? combineLatest(excluded$) : of([]),
    ]).pipe(
      map(([required, excludedSets]) => {
        let allowed = docs;
        for (const ids of required) {
          allowed = allowed
            ? new Set([...allowed].filter(id => ids.has(id)))
            : ids;
        }
        const excluded = new Set(excludedSets.flatMap(ids => [...ids]));
        return { allowed, excluded };
      })
    );
  }

  private searchText$(
    query: string,
    prefer: IndexerPreferOptions,
    limit: number
  ): Observable<DocSearchResult[]> {
    return this.indexer
      .aggregate$(
        'block',
        {
          type: 'boolean',
          occur: 'must',
          queries: [
            {
              type: 'match',
              field: 'content',
              match: query,
            },
            {
              type: 'boolean',
              occur: 'should',
              queries: [
                {
                  type: 'match',
                  field: 'content',
                  match: query,
                },
                {
                  type: 'boost',
                  boost: 1.5,
                  query: {
                    type: 'match',
                    field: 'flavour',
                    match: 'notesgraph:page',
                  },
                },
              ],
            },
          ],
        },
        'docId',
        {
          pagination: {
            limit,
            skip: 0,
          },
          hits: {
            pagination: {
              limit: 2,
              skip: 0,
            },
            fields: ['blockId', 'flavour'],
            highlights: [
              {
                field: 'content',
                before: '<b>',
                end: '</b>',
              },
            ],
          },
          prefer,
        }
      )
      .pipe(
        map(({ buckets }) => {
          const result = [];

          for (const bucket of buckets) {
            const firstMatchFlavour = bucket.hits.nodes[0]?.fields.flavour;
            if (firstMatchFlavour === 'notesgraph:page') {
              // is title match
              const blockContent = normalizeSearchText(
                bucket.hits.nodes[1]?.highlights.content[0]
              ); // try to get block content
              result.push({
                docId: bucket.key,
                title: normalizeSearchText(
                  bucket.hits.nodes[0].highlights.content[0]
                ),
                score: bucket.score,
                blockContent,
              });
            } else {
              const title =
                this.docsService.list.doc$(bucket.key).value?.title$.value ??
                '';
              const matchedBlockId = bucket.hits.nodes[0]?.fields.blockId;
              // is block match
              result.push({
                docId: bucket.key,
                title: title,
                blockId:
                  typeof matchedBlockId === 'string'
                    ? matchedBlockId
                    : matchedBlockId[0],
                score: bucket.score,
                blockContent: normalizeSearchText(
                  bucket.hits.nodes[0]?.highlights.content[0]
                ),
              });
            }
          }

          return result;
        })
      );
  }

  watchRefsFrom(ids: string | string[]) {
    const docIds = Array.isArray(ids) ? ids : [ids];
    if (docIds.length === 0) {
      return of([]);
    }

    return this.indexer
      .search$(
        'block',
        {
          type: 'boolean',
          occur: 'must',
          queries: [
            {
              type: 'boolean',
              occur: 'should',
              queries: docIds.map(id => ({
                type: 'match',
                field: 'docId',
                match: id,
              })),
            },
            {
              type: 'exists',
              field: 'refDocId',
            },
          ],
        },
        {
          fields: ['refDocId', 'ref'],
          pagination: {
            limit: 100,
          },
        }
      )
      .pipe(
        switchMap(({ nodes }) => {
          return fromPromise(async () => {
            const refs: ({ docId: string } & ReferenceParams)[] = Array.from(
              new Map(
                nodes
                  .flatMap(node => {
                    const { ref } = node.fields;
                    return typeof ref === 'string'
                      ? [JSON.parse(ref)]
                      : ref.map(item => JSON.parse(item));
                  })
                  .filter(ref => !docIds.includes(ref.docId))
                  .map(ref => [ref.docId, ref])
              ).values()
            );

            return refs
              .flatMap(ref => {
                const doc = this.docsService.list.doc$(ref.docId).value;
                if (!doc) return null;

                const title = doc.title$.value;
                const params = omit(ref, ['docId']);

                return {
                  title,
                  docId: doc.id,
                  params: isEmpty(params)
                    ? undefined
                    : toDocSearchParams(params),
                };
              })
              .filter(ref => !!ref);
          });
        }),
        // Only propagate downstream when the actual set of linked docs
        // changes (a link was added or removed). Without this guard,
        // every re-index triggered by typing emits a new array (same
        // docs, arbitrary search-engine order) and the navigation panel
        // visibly reorders on every keystroke.
        //
        // Note: this compares docId sets, not order. A stable, meaningful
        // sort order (e.g. document appearance order) requires block
        // position data from the indexer and is tracked separately.
        distinctUntilChanged((prev, curr) => {
          if (prev.length !== curr.length) return false;
          const currIds = new Set(curr.map(r => r.docId));
          return prev.every(r => currIds.has(r.docId));
        })
      );
  }

  /**
   * Docs that link *to* `docId` (the reverse of {@link watchRefsFrom}).
   * Unlike the `DocBacklinks` entity, this isn't scoped to "the currently
   * open doc" — it takes an explicit id, so it can be used from contexts
   * (dialogs, sidebar context menus) where the target doc isn't open.
   */
  watchBacklinksFrom(docId: string) {
    return this.indexer
      .aggregate$(
        'block',
        {
          type: 'match',
          field: 'refDocId',
          match: docId,
        },
        'docId',
        {
          hits: { fields: [], pagination: { limit: 1 } },
          pagination: { limit: 100 },
        }
      )
      .pipe(
        map(({ buckets }) =>
          buckets
            .filter(bucket => bucket.key !== docId)
            .flatMap(bucket => {
              const doc = this.docsService.list.doc$(bucket.key).value;
              if (!doc) return [];
              return [{ docId: bucket.key, title: doc.title$.value }];
            })
        )
      );
  }

  /**
   * Watch every doc→doc reference in the workspace as raw `{ source, target }`
   * pairs (deduplicated, self-loops removed). Used to build the workspace-wide
   * document graph. Unlike {@link watchRefsFrom}, this preserves the source doc
   * of each edge instead of collapsing references by target.
   */
  watchAllRefs() {
    return this.indexer
      .search$(
        'block',
        {
          type: 'exists',
          field: 'refDocId',
        },
        {
          fields: ['docId', 'refDocId'],
          pagination: {
            limit: 10000,
          },
        }
      )
      .pipe(
        map(({ nodes }) => {
          const seen = new Set<string>();
          const edges: { source: string; target: string }[] = [];
          for (const node of nodes) {
            const { docId, refDocId } = node.fields;
            const sources = typeof docId === 'string' ? [docId] : docId;
            const targets =
              typeof refDocId === 'string' ? [refDocId] : refDocId;
            for (const source of sources) {
              for (const target of targets) {
                if (!source || !target || source === target) {
                  continue;
                }
                const key = `${source} ${target}`;
                if (seen.has(key)) {
                  continue;
                }
                seen.add(key);
                edges.push({ source, target });
              }
            }
          }
          return edges;
        }),
        // Only emit when the actual edge set changes, so re-indexing on every
        // keystroke doesn't churn the graph. (Mirrors the guard in
        // `watchRefsFrom`.)
        distinctUntilChanged((prev, curr) => {
          if (prev.length !== curr.length) {
            return false;
          }
          const currKeys = new Set(curr.map(e => `${e.source} ${e.target}`));
          return prev.every(e => currKeys.has(`${e.source} ${e.target}`));
        })
      );
  }

  watchDatabasesTo(docId: string) {
    const DatabaseAdditionalSchema = z.object({
      databaseName: z.string().optional(),
    });
    return this.indexer
      .search$(
        'block',
        {
          type: 'boolean',
          occur: 'must',
          queries: [
            {
              type: 'match',
              field: 'refDocId',
              match: docId,
            },
            {
              type: 'match',
              field: 'parentFlavour',
              match: 'notesgraph:database',
            },
          ],
        },
        {
          fields: ['docId', 'blockId', 'parentBlockId', 'additional'],
          pagination: {
            limit: 100,
          },
        }
      )
      .pipe(
        map(({ nodes }) => {
          return nodes
            .map(node => {
              if (node.fields.docId === docId) {
                // Ignore if it is a link to the current document.
                return null;
              }

              const additional =
                typeof node.fields.additional === 'string'
                  ? node.fields.additional
                  : node.fields.additional[0];

              return {
                docId:
                  typeof node.fields.docId === 'string'
                    ? node.fields.docId
                    : node.fields.docId[0],
                rowId:
                  typeof node.fields.blockId === 'string'
                    ? node.fields.blockId
                    : node.fields.blockId[0],
                databaseBlockId:
                  typeof node.fields.parentBlockId === 'string'
                    ? node.fields.parentBlockId
                    : node.fields.parentBlockId[0],
                databaseName: DatabaseAdditionalSchema.safeParse(additional)
                  .data?.databaseName as string | undefined,
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);
        })
      );
  }

  watchDocSummary(docId: string) {
    return this.indexer
      .search$(
        'doc',
        {
          type: 'match',
          field: 'docId',
          match: docId,
        },
        {
          fields: ['summary'],
          pagination: {
            limit: 1,
          },
        }
      )
      .pipe(
        map(({ nodes }) => {
          const node = nodes.at(0);
          return (
            (typeof node?.fields.summary === 'string'
              ? node?.fields.summary
              : node?.fields.summary[0]) ?? null
          );
        })
      );
  }
}

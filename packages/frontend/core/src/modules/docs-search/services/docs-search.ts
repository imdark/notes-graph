import type { ReferenceParams } from '@blocksuite/notesgraph/model';
import { toDocSearchParams } from '@notesgraph/core/modules/navigation';
import { fromPromise, LiveData, Service } from '@notesgraph/infra';
import type {
  IndexerPreferOptions,
  IndexerSyncState,
} from '@notesgraph/nbstore';
import { isEmpty, omit } from 'lodash-es';
import {
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

  search$(
    query: string,
    prefer: IndexerPreferOptions = 'remote'
  ): Observable<
    {
      docId: string;
      title: string;
      score: number;
      blockId?: string;
      blockContent?: string;
    }[]
  > {
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
            limit: 50,
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

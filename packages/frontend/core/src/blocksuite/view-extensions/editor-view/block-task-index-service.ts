import type {
  BlockTaskFilter,
  BlockTaskHit,
} from '@blocksuite/notesgraph/shared/services';
import {
  BlockTaskIndexProvider,
  trailHasSection,
  trailSections,
} from '@blocksuite/notesgraph/shared/services';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import { DocsSearchService } from '@notesgraph/core/modules/docs-search';
import type { FrameworkProvider } from '@notesgraph/infra';
import type { Query, SearchOptions } from '@notesgraph/nbstore';
// aliased: `filter` is taken by queryTaskBlocks$'s own BlockTaskFilter param
import {
  catchError,
  combineLatest,
  filter as filterOp,
  map,
  of,
  startWith,
  timeout,
} from 'rxjs';

/**
 * Bridges the workspace's block index into the editor: query boards ask for
 * "every task block matching these #tag / #key:value tokens" and get a live
 * observable back, fed by the union of the on-device index and the server's
 * (see the note on the two queries below for why it takes both).
 */
export function patchBlockTaskIndexService(
  framework: FrameworkProvider
): ExtensionType {
  const docsSearchService = framework.get(DocsSearchService);

  const provider: BlockTaskIndexProvider = {
    queryTaskBlocks$: (filter: BlockTaskFilter) => {
      // A section scope (tasks nested under a named heading, e.g. a journal's
      // per-project sections) can't be pushed into the index query: todoTrail
      // is stored unindexed. So when one is present the doc scope has to come
      // off the query too and both are applied to the returned hits instead —
      // otherwise the index would drop the journal tasks before we could
      // match their trail.
      const sectionName = filter.sectionName?.trim().toLowerCase();
      const excludeSections = new Set(
        (filter.excludeSectionNames ?? [])
          .map(name => name.trim().toLowerCase())
          .filter(Boolean)
      );

      // A defined-but-empty docId scope (e.g. an empty project) matches
      // nothing — short-circuit rather than emit an unconstrained query. With
      // a section scope it is not empty: the project may still own tasks
      // written under its heading in a journal.
      if (filter.docIds && filter.docIds.length === 0 && !sectionName) {
        return of({ hits: [], complete: true });
      }
      const wantedDocIds = filter.docIds ? new Set(filter.docIds) : null;



      // Status scope: incomplete checkboxes only, any checkbox, or (legacy,
      // for query boards) any block carrying an org status.
      const statusQuery =
        filter.todoOnly === true
          ? ({ type: 'match', field: 'todoStatus', match: 'todo' } as const)
          : filter.todoOnly === false
            ? ({ type: 'exists', field: 'todoStatus' } as const)
            : // Legacy (query boards): any task block — one with an org status
              // OR a plain checkbox (todoStatus but no org annotation), so
              // ordinary to-do items aren't silently dropped.
              {
                type: 'boolean' as const,
                occur: 'should' as const,
                queries: [
                  { type: 'exists' as const, field: 'orgStatus' as const },
                  { type: 'exists' as const, field: 'todoStatus' as const },
                ],
              };

      const query = {
        type: 'boolean',
        occur: 'must',
        queries: [
          statusQuery,
          ...(filter.tags ?? []).map(
            tag => ({ type: 'match', field: 'tags', match: tag }) as const
          ),
          ...(filter.props ?? []).map(
            prop => ({ type: 'match', field: 'props', match: prop }) as const
          ),
          // Scope to a set of docs (a project's members) — any-of. Skipped
          // when a section scope is active; see above.
          ...(filter.docIds && !sectionName
            ? [
                {
                  type: 'boolean' as const,
                  occur: 'should' as const,
                  queries: filter.docIds.map(id => ({
                    type: 'match' as const,
                    field: 'docId' as const,
                    match: id,
                  })),
                },
              ]
            : []),
        ],
      } satisfies Query<'block'>;
      const searchOptions = {
        fields: ['docId', 'blockId', 'tags', 'props', 'content', 'todoTrail'],
        pagination: { limit: 1000 },
      } satisfies SearchOptions<'block'>;

      const toHits = (result: {
        nodes: readonly {
          fields: Partial<
            Record<(typeof searchOptions)['fields'][number], string | string[]>
          >;
        }[];
      }): BlockTaskHit[] => {
        const hits: BlockTaskHit[] = [];
        const wantedTags = filter.tags ?? [];
        const wantedProps = filter.props ?? [];
        for (const node of result.nodes) {
          const docId = node.fields.docId;
          const blockId = node.fields.blockId;
          if (typeof docId !== 'string' || typeof blockId !== 'string') {
            continue;
          }
          // exactness guard: index matching can be tokenized (e.g. the
          // server path), so re-check the tokens verbatim
          const nodeTags = toArray(node.fields.tags);
          const nodeProps = toArray(node.fields.props);
          const trail = firstString(node.fields.todoTrail);

          // In scope if the doc is in scope, OR the task sits under the named
          // section wherever it was written (the journal case).
          const inDocScope = !wantedDocIds || wantedDocIds.has(docId);
          const inSectionScope = sectionName
            ? trailHasSection(trail, sectionName)
            : false;
          // Inbox: a task under some project's heading belongs to that
          // project, not here, even though its doc has no project.
          const excludedBySection =
            excludeSections.size > 0 &&
            trailSections(trail).some(part =>
              excludeSections.has(part.toLowerCase())
            );

          if (
            (inDocScope || inSectionScope) &&
            !excludedBySection &&
            wantedTags.every(tag => nodeTags.includes(tag)) &&
            wantedProps.every(prop => nodeProps.includes(prop))
          ) {
            hits.push({
              docId,
              blockId,
              text: firstString(node.fields.content),
              trail,
            });
          }
        }
        return hits;
      };

      // Union of BOTH indexes, because neither alone is complete and either
      // can come back empty:
      //
      // - local only covers docs this device has actually opened/synced, so a
      //   workspace-wide board (the journal's "todos:" Task List scans every
      //   project/inbox doc) misses tasks in docs never opened here.
      // - remote covers the whole workspace, but only once the server has
      //   indexed these fields. A cloud workspace whose server index predates
      //   the block task-entity columns (or whose rebuild/backfill hasn't run)
      //   matches nothing for `exists(todoStatus|orgStatus)` — and since
      //   `prefer: 'remote'` routes *exclusively* to the server with no
      //   fallback, querying remote alone showed an empty board on every
      //   client at once, even for tasks sitting in docs already synced
      //   locally.
      //
      // startWith/catchError keep each side independent: whichever index
      // answers first renders, and one that errors, never connects, or knows
      // nothing can only ever add rows — never blank out the other's.
      // `null` means "this index hasn't answered yet", as distinct from "it
      // answered with nothing" — the consumer treats its first emission as
      // proof the query came back, and an emission it never asked for would
      // make an empty board claim "No results." before either index replied.
      const hits$ = (prefer?: 'remote') =>
        docsSearchService.indexer
          .search$(
            'block',
            query,
            prefer ? { ...searchOptions, prefer } : searchOptions
          )
          .pipe(
            map(toHits),
            // An index that never answers at all (remote while offline —
            // search$ waits on the connection) would otherwise leave the
            // query permanently incomplete, and its spinner up for good.
            // Treat prolonged silence as "answered with nothing"; a later
            // real answer still comes through and adds its rows.
            timeout({ first: 15_000, with: () => of<BlockTaskHit[]>([]) }),
            catchError(() => of<BlockTaskHit[]>([])),
            startWith<BlockTaskHit[] | null>(null)
          );

      return combineLatest([hits$(), hits$('remote')]).pipe(
        // Both still unanswered → stay silent rather than emit a hollow [].
        filterOp(results => results.some(hits => hits !== null)),
        map(results => {
          const byKey = new Map<string, BlockTaskHit>();
          for (const hits of results) {
            for (const hit of hits ?? []) {
              const key = `${hit.docId}:${hit.blockId}`;
              const existing = byKey.get(key);
              // Prefer whichever copy carries the text/trail — the two
              // indexes can disagree on which stored fields they have.
              if (!existing || (!existing.text && hit.text)) {
                byKey.set(key, hit);
              }
            }
          }
          // Deterministic order, because the two indexes return hits in
          // different orders (relevance/insertion) — merging the second one
          // in would otherwise reshuffle the whole list, and with the list
          // view paginating at 8 rows that reads as the visible rows being
          // swapped out rather than added to. Grouping by doc also keeps a
          // doc's tasks together, which is how they're written.
          const hits = [...byKey.values()].sort(
            (a, b) =>
              a.docId.localeCompare(b.docId) ||
              a.blockId.localeCompare(b.blockId)
          );
          return {
            hits,
            // Only final once BOTH indexes have answered — the faster one
            // answering first must not let an empty scope claim "no results"
            // while the other is still fetching.
            complete: results.every(hits => hits !== null),
          };
        })
      );
    },
  };

  return {
    setup: di => {
      di.addImpl(BlockTaskIndexProvider, () => provider);
    },
  };
}

function toArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value ? [value] : [];
  return [];
}

/** A field can come back as a string or an array of strings; take the first. */
function firstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string') return value;
  return undefined;
}

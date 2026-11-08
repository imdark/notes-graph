import { AiThinkingIcon } from '@blocksuite/icons/rc';
import { ServerFeature } from '@notesgraph/graphql';
import { effect, Entity, LiveData, onStart } from '@notesgraph/infra';
import { truncate } from 'lodash-es';
import {
  catchError,
  combineLatest,
  map,
  of,
  switchMap,
  tap,
  throttleTime,
} from 'rxjs';

import type { WorkspaceServerService } from '../../cloud';
import type { DocsService } from '../../doc';
import type { DocDisplayMetaService } from '../../doc-display-meta';
import type { DocsSearchService } from '../../docs-search';
import { parseSearchQuery } from '../../docs-search/utils/search-query';
import type { QuickSearchSession } from '../providers/quick-search-provider';
import type { QuickSearchItem } from '../types/item';

interface AskGraphPayload {
  docId: string;
  blockId?: string | undefined;
  blockContent?: string | undefined;
}

/** Prefix that switches Ctrl-K into "ask the graph" mode: `? how do I deploy`. */
export const ASK_GRAPH_PREFIX = '?';

/** Docs carrying any of these inline tags are treated as learnings. */
export const LEARNING_TAGS = ['learning', 'learnings', 'lesson', 'til'];

const MAX_PER_GROUP = 8;

/**
 * Ask-the-graph mode for Ctrl-K. A query starting with `?` retrieves, across
 * the whole workspace, the learnings (docs tagged #learning, #lesson, #til)
 * that match the question, followed by any other notes that match, so earlier
 * knowledge surfaces before the user rewrites it. Without the prefix it stays
 * silent and the normal docs search handles the query.
 */
export class AskGraphQuickSearchSession
  extends Entity
  implements QuickSearchSession<'docs', AskGraphPayload>
{
  constructor(
    private readonly workspaceServerService: WorkspaceServerService,
    private readonly docsSearchService: DocsSearchService,
    private readonly docsService: DocsService,
    private readonly docDisplayMetaService: DocDisplayMetaService
  ) {
    super();
  }

  private readonly isQueryLoading$ = new LiveData(false);

  isLoading$ = this.isQueryLoading$;

  error$ = new LiveData<any>(null);

  items$ = new LiveData<QuickSearchItem<'docs', AskGraphPayload>[]>([]);

  private prefer(): 'remote' | 'local' {
    return this.workspaceServerService.server?.config$.value.features.includes(
      ServerFeature.Indexer
    )
      ? 'remote'
      : 'local';
  }

  query = effect(
    throttleTime<string>(500, undefined, { leading: false, trailing: true }),
    switchMap((query: string) => {
      const trimmed = query.trim();
      if (!trimmed.startsWith(ASK_GRAPH_PREFIX)) {
        return of({ items: [] as QuickSearchItem<'docs', AskGraphPayload>[] });
      }
      const text = parseSearchQuery(
        trimmed.slice(ASK_GRAPH_PREFIX.length)
      ).text.trim();
      if (text.length < 2) {
        return of({ items: [] as QuickSearchItem<'docs', AskGraphPayload>[] });
      }
      const prefer = this.prefer();
      const learnings$ = this.docsSearchService.search$(text, prefer, {
        text,
        tags: LEARNING_TAGS,
        props: [],
        docs: [],
        dates: [],
        include: [],
        exclude: [],
      });
      const related$ = this.docsSearchService.search$(text, prefer);
      return combineLatest([learnings$, related$]).pipe(
        onStart(() => {
          this.error$.next(null);
          this.isQueryLoading$.next(true);
        }),
        map(([learnings, related]) => {
          const seen = new Set<string>();
          const build = (
            docs: typeof learnings,
            groupId: string,
            i18nKey: string,
            groupScore: number
          ) =>
            docs
              .flatMap(doc => {
                if (seen.has(doc.docId)) return [];
                const record = this.docsService.list.doc$(doc.docId).value;
                return record ? [{ doc, record }] : [];
              })
              .slice(0, MAX_PER_GROUP)
              .map(({ doc, record }) => {
                seen.add(doc.docId);
                const { title, updatedDate } =
                  this.docDisplayMetaService.getDocDisplayMeta(record);
                return {
                  id: `ask-graph:${groupId}:${doc.docId}`,
                  source: 'docs',
                  group: {
                    id: groupId,
                    label: { i18nKey, options: { query: truncate(text) } },
                    score: groupScore,
                  },
                  label: { title, subTitle: doc.blockContent },
                  score: doc.score,
                  icon: AiThinkingIcon,
                  timestamp: updatedDate,
                  payload: doc,
                } as QuickSearchItem<'docs', AskGraphPayload>;
              });
          return {
            items: [
              ...build(
                learnings,
                'ask-graph-learnings',
                'com.notesgraph.quicksearch.group.ask-graph-learnings',
                10
              ),
              ...build(
                related,
                'ask-graph-related',
                'com.notesgraph.quicksearch.group.ask-graph-related',
                9
              ),
            ],
          };
        }),
        catchError(err => {
          this.error$.next(err instanceof Error ? err.message : err);
          return of({
            items: [] as QuickSearchItem<'docs', AskGraphPayload>[],
          });
        })
      );
    }),
    tap(({ items }) => {
      this.items$.next(items);
      this.isQueryLoading$.next(false);
    })
  );

  override dispose(): void {
    this.query.unsubscribe();
  }
}

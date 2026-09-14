import { SearchIcon } from '@blocksuite/icons/rc';
import { ServerFeature } from '@notesgraph/graphql';
import {
  effect,
  Entity,
  LiveData,
  onComplete,
  onStart,
} from '@notesgraph/infra';
import { truncate } from 'lodash-es';
import { catchError, EMPTY, map, of, switchMap, tap, throttleTime } from 'rxjs';

import type { WorkspaceServerService } from '../../cloud';
import type { DocRecord, DocsService } from '../../doc';
import type { DocDisplayMetaService } from '../../doc-display-meta';
import type { DocsSearchService } from '../../docs-search';
import type { FeatureFlagService } from '../../feature-flag';
import type { WorkspaceService } from '../../workspace';
import type { QuickSearchSession } from '../providers/quick-search-provider';
import type { QuickSearchItem } from '../types/item';
import { suggestSimilarTitles } from '../utils/fuzzy';

interface DocsPayload {
  docId: string;
  title?: string;
  blockId?: string | undefined;
  blockContent?: string | undefined;
}

export class DocsQuickSearchSession
  extends Entity
  implements QuickSearchSession<'docs', DocsPayload>
{
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceServerService: WorkspaceServerService,
    private readonly docsSearchService: DocsSearchService,
    private readonly docsService: DocsService,
    private readonly docDisplayMetaService: DocDisplayMetaService,
    private readonly featureFlagService: FeatureFlagService
  ) {
    super();
  }

  private readonly isSupportServerIndexer = () =>
    this.workspaceServerService.server?.config$.value.features.includes(
      ServerFeature.Indexer
    ) ?? false;

  private readonly isEnableBatterySaveMode = () =>
    this.featureFlagService.flags.enable_battery_save_mode.value;

  private readonly isIndexerLoading$ = this.docsSearchService.indexerState$.map(
    ({ completed }) => {
      return !completed;
    }
  );

  private readonly isQueryLoading$ = new LiveData(false);

  isCloudWorkspace = this.workspaceService.workspace.flavour !== 'local';

  searchLocallyItem = {
    id: 'search-locally',
    source: 'docs',
    label: {
      title: {
        i18nKey: 'com.notesgraph.quicksearch.search-locally',
      },
    },
    score: 1000,
    icon: SearchIcon,
    payload: {
      docId: '',
    },
    beforeSubmit: () => {
      this.searchLocally = true;
      this.query(this.lastQuery);
      return false;
    },
  } as QuickSearchItem<'docs', DocsPayload>;

  isLoading$ = LiveData.computed(get => {
    return (
      (this.isCloudWorkspace ? false : get(this.isIndexerLoading$)) ||
      get(this.isQueryLoading$)
    );
  });

  error$ = new LiveData<any>(null);

  lastQuery = '';

  items$ = new LiveData<QuickSearchItem<'docs', DocsPayload>[]>([]);

  searchLocally = !this.isCloudWorkspace;

  query = effect(
    tap(query => {
      this.lastQuery = query;
    }),
    throttleTime<string>(500, undefined, {
      leading: false,
      trailing: true,
    }),
    switchMap((query: string) => {
      // A quoted query ("…") is an exact-phrase search: we still hit the
      // indexer with the inner phrase (token match) for candidates, then keep
      // only docs whose title or matched content contains the phrase verbatim.
      const trimmed = query.trim();
      const exactMatch =
        trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
      const phrase = exactMatch ? trimmed.slice(1, -1).trim() : '';
      const searchTerm = exactMatch ? phrase : query;
      let out;
      if (!searchTerm) {
        out = of({ items: [], useLocalLabel: false });
      } else {
        const preferRemote =
          !this.searchLocally && this.isSupportServerIndexer();
        const preferMode =
          this.searchLocally || !this.isSupportServerIndexer()
            ? 'local'
            : 'remote';
        // Surface silent local fallbacks: a cloud workspace searching locally
        // only sees docs that were opened on this device, which reads as
        // "search is broken". Loud so it lands in the in-app error inventory.
        if (this.isCloudWorkspace && !this.searchLocally && !preferRemote) {
          console.error(
            `[NG-DIAG search] server indexer not advertised by cached config ` +
              `(server=${this.workspaceServerService.server?.baseUrl}, features=${JSON.stringify(
                this.workspaceServerService.server?.config$.value.features
              )}) — falling back to local index`
          );
        }
        const search$ = preferRemote
          ? this.docsSearchService.search$(searchTerm, 'remote').pipe(
              switchMap(docs => {
                if (docs.length > 0) {
                  return of({ docs, useLocalLabel: false });
                }
                return this.docsSearchService.search$(searchTerm, 'local').pipe(
                  map(localDocs => ({
                    docs: localDocs,
                    useLocalLabel: true,
                  }))
                );
              }),
              catchError(err => {
                console.error(
                  '[NG-DIAG search] remote search failed — falling back to local index:',
                  err
                );
                return this.docsSearchService.search$(searchTerm, 'local').pipe(
                  map(localDocs => ({
                    docs: localDocs,
                    useLocalLabel: true,
                  }))
                );
              })
            )
          : this.docsSearchService.search$(searchTerm, preferMode).pipe(
              map(docs => ({
                docs,
                useLocalLabel: preferMode === 'local',
              }))
            );

        out = search$.pipe(
          map(({ docs, useLocalLabel }) => {
            const needle = phrase.toLowerCase();
            const items = docs
              .map(doc => {
                const docRecord = this.docsService.list.doc$(doc.docId).value;
                return [doc, docRecord] as const;
              })
              .filter(
                (props): props is [(typeof props)[0], DocRecord] => !!props[1]
              )
              .filter(([doc, docRecord]) => {
                if (!exactMatch) {
                  return true;
                }
                // Keep only verbatim matches: the phrase must appear in the
                // title or the matched block content (highlight tags stripped).
                const content = (doc.blockContent ?? '')
                  .replace(/<\/?b>/g, '')
                  .toLowerCase();
                const docTitle = (docRecord.title$.value ?? '').toLowerCase();
                return content.includes(needle) || docTitle.includes(needle);
              })
              .map(([doc, docRecord]) => {
                const { title, icon, updatedDate } =
                  this.docDisplayMetaService.getDocDisplayMeta(docRecord);
                return {
                  id: 'doc:' + docRecord.id,
                  source: 'docs',
                  group: {
                    id: 'docs',
                    label: {
                      i18nKey: useLocalLabel
                        ? 'com.notesgraph.quicksearch.group.searchfor-locally'
                        : 'com.notesgraph.quicksearch.group.searchfor',
                      options: { query: truncate(query) },
                    },
                    score: 5,
                  },
                  label: {
                    title: title,
                    subTitle: doc.blockContent,
                  },
                  score: doc.score,
                  icon,
                  timestamp: updatedDate,
                  payload: doc,
                } as QuickSearchItem<'docs', DocsPayload>;
              });
            // No hits for a real (non-phrase) query → offer typo-corrected
            // title matches instead of an empty result.
            const finalItems =
              !exactMatch &&
              items.length === 0 &&
              searchTerm.trim().length >= 3
                ? this.suggestSimilarDocs(query)
                : items;
            return { items: finalItems, useLocalLabel };
          })
        );
      }
      return out.pipe(
        tap(({ items, useLocalLabel }) => {
          this.items$.next(
            this.isSupportServerIndexer() &&
              !this.searchLocally &&
              !this.isEnableBatterySaveMode() &&
              !useLocalLabel
              ? [...items, this.searchLocallyItem]
              : items
          );
          this.isQueryLoading$.next(false);
        }),
        onStart(() => {
          this.error$.next(null);
          this.items$.next(
            this.isSupportServerIndexer() &&
              !this.searchLocally &&
              !this.isEnableBatterySaveMode()
              ? [this.searchLocallyItem]
              : []
          );
          this.isQueryLoading$.next(true);
        }),
        catchError(err => {
          this.error$.next(err instanceof Error ? err.message : err);
          this.items$.next(
            this.isSupportServerIndexer() &&
              !this.searchLocally &&
              !this.isEnableBatterySaveMode()
              ? [this.searchLocallyItem]
              : []
          );
          this.isQueryLoading$.next(false);
          return EMPTY;
        }),
        onComplete(() => {})
      );
    })
  );

  // TODO(@EYHN): load more

  /**
   * "Did you mean" fallback: when a real query matches no docs, surface the
   * closest doc titles by fuzzy (typo-tolerant) match so a misspelling still
   * leads somewhere. Selecting one opens that doc (same 'docs' payload path).
   */
  private suggestSimilarDocs(
    query: string
  ): QuickSearchItem<'docs', DocsPayload>[] {
    const candidates = this.docsService.list.docs$.value
      .filter(record => !record.trash$.value)
      .map(record => ({ docId: record.id, title: record.title$.value ?? '' }));
    return suggestSimilarTitles(query, candidates, 3)
      .map(match => {
        const record = this.docsService.list.doc$(match.docId).value;
        if (!record) return null;
        const { title, icon, updatedDate } =
          this.docDisplayMetaService.getDocDisplayMeta(record);
        return {
          id: 'did-you-mean:' + match.docId,
          source: 'docs',
          group: {
            id: 'did-you-mean',
            label: {
              i18nKey: 'com.notesgraph.quicksearch.group.did-you-mean',
            },
            score: 6,
          },
          label: { title },
          score: 100 - Math.round(match.ratio * 100),
          icon,
          timestamp: updatedDate,
          payload: { docId: match.docId },
        } as QuickSearchItem<'docs', DocsPayload>;
      })
      .filter((item): item is QuickSearchItem<'docs', DocsPayload> => !!item);
  }

  override dispose(): void {
    this.query.unsubscribe();
  }
}

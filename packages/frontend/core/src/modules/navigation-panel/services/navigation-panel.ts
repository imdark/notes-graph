import { LiveData, Service } from '@notesgraph/infra';

import type { GlobalCache } from '../../storage/providers/global';
import type { WorkspaceService } from '../../workspace';

const DEFAULT_COLLAPSABLE_STATE: Record<string, boolean> = {
  recent: true,
  favorites: false,
  notes: false,
  'notes:inbox': false,
  organize: false,
  collections: true,
  tags: true,
  favoritesOld: true,
  migrationFavorites: true,
  others: false,
};

export class NavigationPanelService extends Service {
  constructor(
    private readonly globalCache: GlobalCache,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
  }

  private readonly collapsedCache = new Map<string, LiveData<boolean>>();

  collapsed$(path: string[], defaultCollapsed?: boolean) {
    const pathKey = path.join(':');
    const key = `navigation:${this.workspaceService.workspace.id}:${pathKey}`;
    const cached$ = this.collapsedCache.get(key);
    if (!cached$) {
      const liveData$ = LiveData.from(
        this.globalCache.watch<boolean>(key),
        undefined
      ).map(
        v => v ?? DEFAULT_COLLAPSABLE_STATE[pathKey] ?? defaultCollapsed ?? true
      );
      this.collapsedCache.set(key, liveData$);
      return liveData$;
    }
    return cached$;
  }

  setCollapsed(path: string[], collapsed: boolean) {
    const pathKey = path.join(':');
    const key = `navigation:${this.workspaceService.workspace.id}:${pathKey}`;
    this.globalCache.set(key, collapsed);
  }

  // Optimistic doc→doc parent links (child id -> parent id). The notes tree
  // is built from the indexer, which lags a beat behind a just-created link
  // (addLinkedDoc only mutates Yjs content; the indexer picks it up
  // asynchronously off a storage-update subscription). Without this, a
  // freshly linked child briefly renders as an unparented root and jumps
  // into place once indexing catches up. Callers register the known parent
  // here right away so the tree can place it correctly from the first
  // render, then clear the entry once the real edge is indexed.
  readonly optimisticLinks$ = new LiveData<Map<string, string>>(new Map());

  addOptimisticLink(parentDocId: string, childDocId: string) {
    const next = new Map(this.optimisticLinks$.value);
    next.set(childDocId, parentDocId);
    this.optimisticLinks$.next(next);
  }

  clearOptimisticLink(childDocId: string) {
    if (!this.optimisticLinks$.value.has(childDocId)) {
      return;
    }
    const next = new Map(this.optimisticLinks$.value);
    next.delete(childDocId);
    this.optimisticLinks$.next(next);
  }
}

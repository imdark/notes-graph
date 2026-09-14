import { WorkspaceDBService } from '@notesgraph/core/modules/db';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';

export interface GraphNodePagesApi {
  /** docId -> current child page index (page 0 omitted). */
  pages: Record<string, number>;
  /** False until the stored pages have been read from the DB. */
  pagesLoaded: boolean;
  setNodePage: (id: string, page: number) => void;
}

/**
 * Current child page of each node in the document graph view, persisted in the
 * per-user workspace `userdata` DB (`graphNodePage` table) — same store as the
 * pinned positions / viewport, so paging follows the user across reloads and
 * devices.
 */
export function useGraphNodePages(): GraphNodePagesApi {
  const dbService = useService(WorkspaceDBService);

  const rows$ = useMemo(
    () =>
      dbService.userdataDB$
        .map(db => LiveData.from(db.graphNodePage.find$(), undefined))
        .flat(),
    [dbService]
  );
  const rows = useLiveData(rows$);

  const pagesLoaded = rows !== undefined;
  const pages = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const row of rows ?? []) map[row.id] = row.page;
    return map;
  }, [rows]);

  const setNodePage = useCallback(
    (id: string, page: number) => {
      const db = dbService.userdataDB$.value;
      const existing = db.graphNodePage.get(id);
      // Page 0 is the default — drop the row instead of storing it.
      if (page <= 0) {
        if (existing) db.graphNodePage.delete(id);
        return;
      }
      if (existing) {
        db.graphNodePage.update(id, { page });
      } else {
        db.graphNodePage.create({ id, page });
      }
    },
    [dbService]
  );

  return { pages, pagesLoaded, setNodePage };
}

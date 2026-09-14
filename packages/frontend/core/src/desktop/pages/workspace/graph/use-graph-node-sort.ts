import { WorkspaceDBService } from '@notesgraph/core/modules/db';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';

export interface GraphNodeSortApi {
  /** docId -> manual sort key (nodes without one fall back to createDate). */
  sortKeys: Record<string, number>;
  /** False until the stored keys have been read from the DB. */
  sortKeysLoaded: boolean;
  setSortKey: (id: string, key: number) => void;
}

/**
 * Manual sort keys for graph nodes, persisted in the per-user workspace
 * `userdata` DB (`graphNodeSort` table). Children are ordered by ascending key;
 * keys are fractional so a new node can be slotted between two existing ones
 * (e.g. a "5.5" between 5 and 6) to land on the current page.
 */
export function useGraphNodeSort(): GraphNodeSortApi {
  const dbService = useService(WorkspaceDBService);

  const rows$ = useMemo(
    () =>
      dbService.userdataDB$
        .map(db => LiveData.from(db.graphNodeSort.find$(), undefined))
        .flat(),
    [dbService]
  );
  const rows = useLiveData(rows$);

  const sortKeysLoaded = rows !== undefined;
  const sortKeys = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const row of rows ?? []) map[row.id] = row.key;
    return map;
  }, [rows]);

  const setSortKey = useCallback(
    (id: string, key: number) => {
      const db = dbService.userdataDB$.value;
      if (db.graphNodeSort.get(id)) {
        db.graphNodeSort.update(id, { key });
      } else {
        db.graphNodeSort.create({ id, key });
      }
    },
    [dbService]
  );

  return { sortKeys, sortKeysLoaded, setSortKey };
}

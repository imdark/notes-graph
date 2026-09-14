import { WorkspaceDBService } from '@notesgraph/core/modules/db';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';

import type { PinnedPositions } from './graph-view';

export interface PinnedPositionsApi {
  pinned: PinnedPositions;
  pinNode: (id: string, x: number, y: number) => void;
  unpinNode: (id: string) => void;
}

/**
 * User-pinned graph node positions, persisted in the per-user workspace
 * `userdata` DB (`graphNodePosition` table). That store persists locally for
 * offline / local workspaces and syncs to the backend DB for cloud workspaces,
 * so pins follow the user across devices.
 */
export function usePinnedPositions(): PinnedPositionsApi {
  const dbService = useService(WorkspaceDBService);

  const positions$ = useMemo(
    () =>
      dbService.userdataDB$
        .map(db => LiveData.from(db.graphNodePosition.find$(), []))
        .flat(),
    [dbService]
  );
  const raw = useLiveData(positions$);

  const pinned = useMemo<PinnedPositions>(() => {
    const map: PinnedPositions = {};
    for (const p of raw ?? []) {
      map[p.id] = { x: p.x, y: p.y };
    }
    return map;
  }, [raw]);

  const pinNode = useCallback(
    (id: string, x: number, y: number) => {
      const db = dbService.userdataDB$.value;
      if (db.graphNodePosition.get(id)) {
        db.graphNodePosition.update(id, { x, y });
      } else {
        db.graphNodePosition.create({ id, x, y });
      }
    },
    [dbService]
  );

  const unpinNode = useCallback(
    (id: string) => {
      dbService.userdataDB$.value.graphNodePosition.delete(id);
    },
    [dbService]
  );

  return { pinned, pinNode, unpinNode };
}

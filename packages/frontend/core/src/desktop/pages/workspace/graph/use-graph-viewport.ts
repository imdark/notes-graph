import { WorkspaceDBService } from '@notesgraph/core/modules/db';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';

export interface GraphViewport {
  x: number;
  y: number;
  k: number;
}

export interface GraphViewportApi {
  /** Saved viewport, or `null` if none has been stored yet. */
  viewport: GraphViewport | null;
  /** False until the stored viewport has been read from the DB. */
  viewportLoaded: boolean;
  saveViewport: (viewport: GraphViewport) => void;
}

// There is a single graph viewport per workspace, keyed by a constant.
const VIEWPORT_ID = 'default';

/**
 * Saved pan/zoom of the document graph view, persisted in the per-user
 * workspace `userdata` DB (`graphViewport` table) — same store as the pinned
 * positions, so the view follows the user across reloads and devices.
 */
export function useGraphViewport(): GraphViewportApi {
  const dbService = useService(WorkspaceDBService);

  const rows$ = useMemo(
    () =>
      dbService.userdataDB$
        .map(db => LiveData.from(db.graphViewport.find$(), undefined))
        .flat(),
    [dbService]
  );
  const rows = useLiveData(rows$);

  const viewportLoaded = rows !== undefined;
  const viewport = useMemo<GraphViewport | null>(() => {
    const row = rows?.[0];
    return row ? { x: row.x, y: row.y, k: row.k } : null;
  }, [rows]);

  const saveViewport = useCallback(
    (next: GraphViewport) => {
      const db = dbService.userdataDB$.value;
      if (db.graphViewport.get(VIEWPORT_ID)) {
        db.graphViewport.update(VIEWPORT_ID, next);
      } else {
        db.graphViewport.create({ id: VIEWPORT_ID, ...next });
      }
    },
    [dbService]
  );

  return { viewport, viewportLoaded, saveViewport };
}

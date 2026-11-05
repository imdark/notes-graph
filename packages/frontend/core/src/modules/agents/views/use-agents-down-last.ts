import { type LiveData, useLiveData, useService } from '@notesgraph/infra';
import { useEffect, useMemo } from 'react';

import { FleetService } from '../services/fleet';

/**
 * The agents for a list a person picks from, with those on a machine
 * monitoring reports down last. Keeps the machines' health fresh while the
 * list is shown. Pass a stable `agents$` (memoised), or it re-subscribes on
 * every render.
 */
export function useAgentsDownLast<T extends { deviceKey?: string }>(
  agents$: LiveData<T[]>
): T[] {
  const fleet = useService(FleetService);
  useEffect(() => fleet.watch(), [fleet]);
  return useLiveData(useMemo(() => fleet.downLast$(agents$), [fleet, agents$]));
}

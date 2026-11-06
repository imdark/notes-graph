import type { DocMeta } from '@blocksuite/notesgraph/store';
import { Loading, Skeleton } from '@notesgraph/component';
import { useBlockSuiteDocMeta } from '@notesgraph/core/components/hooks/use-block-suite-page-meta';
import { useSystemOnline } from '@notesgraph/core/components/hooks/use-system-online';
import { GlobalCacheService } from '@notesgraph/core/modules/storage';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import { useEffect, useMemo, useState } from 'react';

import { DocCard } from '../../components/doc-card';
import { CollapsibleSection } from '../../components/navigation';
import * as styles from './styles.css';

/**
 * How long the last settled list is held while this start's sync is still
 * catching up. Past it (offline, a stuck sync) the live list takes over, so
 * stale cards are never pinned for good.
 */
const HOLD_TIMEOUT_MS = 30_000;

const cacheKey = (workspaceId: string) => `recent-docs:${workspaceId}`;

export const RecentDocs = ({ max = 5 }: { max?: number }) => {
  const workspace = useService(WorkspaceService).workspace;
  const globalCache = useService(GlobalCacheService).globalCache;
  const allPageMetas = useBlockSuiteDocMeta(workspace.docCollection);
  const isOnline = useSystemOnline();
  const engineState = useLiveData(
    useMemo(() => LiveData.from(workspace.engine.doc.state$, null), [workspace])
  );

  const liveMetas = useMemo(() => {
    return [...allPageMetas]
      .filter(meta => !meta.trash)
      .sort((a, b) => (b.updatedDate ?? 0) - (a.updatedDate ?? 0))
      .slice(0, max);
  }, [allPageMetas, max]);

  // On a cold start the live list reshuffles for every doc that lands from
  // sync, so the cards visibly fast-forward through stale orders. Instead,
  // show the list as it was when sync last settled, with a spinner, and only
  // switch to the live list once this start's sync has caught up.
  const [cachedIds] = useState<string[] | null>(
    () => globalCache.get<string[]>(cacheKey(workspace.id)) ?? null
  );
  const [settled, setSettled] = useState(
    () => !cachedIds || cachedIds.length === 0
  );
  const synced = !!engineState?.synced;

  useEffect(() => {
    if (settled) return;
    if (synced || !isOnline) {
      setSettled(true);
      return;
    }
    const timer = setTimeout(() => setSettled(true), HOLD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [settled, synced, isOnline]);

  // Once settled, keep the cache at what the user sees.
  const liveIds = useMemo(() => liveMetas.map(meta => meta.id), [liveMetas]);
  useEffect(() => {
    if (!settled) return;
    globalCache.set(cacheKey(workspace.id), liveIds);
  }, [settled, liveIds, globalCache, workspace.id]);

  // While holding: the cached order, each id resolved against the current
  // metas; one not loaded yet (the root doc is still coming in) shows as a
  // placeholder of the same size rather than popping the section around.
  const cards = useMemo<(DocMeta | { id: string; placeholder: true })[]>(() => {
    if (settled || !cachedIds) return liveMetas;
    const byId = new Map(allPageMetas.map(meta => [meta.id, meta]));
    return cachedIds.slice(0, max).map(id => {
      const meta = byId.get(id);
      return meta && !meta.trash ? meta : { id, placeholder: true as const };
    });
  }, [settled, cachedIds, liveMetas, allPageMetas, max]);

  if (!cards.length) {
    return null;
  }

  return (
    <CollapsibleSection
      path={['recent']}
      title="Recent"
      headerClassName={styles.header}
      className={styles.recentSection}
      testId="recent-docs"
      actions={
        settled ? null : (
          <span data-testid="recent-docs-syncing" title="Catching up…">
            <Loading size={16} />
          </span>
        )
      }
    >
      <div className={styles.scroll} data-testid="recent-docs-list">
        <ul className={styles.list}>
          {cards.map(doc => (
            <li key={doc.id} className={styles.cardWrapper}>
              {'placeholder' in doc ? (
                <Skeleton
                  variant="rectangular"
                  width="100%"
                  height="100%"
                  data-testid="doc-card-placeholder"
                />
              ) : (
                <DocCard meta={doc} />
              )}
            </li>
          ))}
        </ul>
      </div>
    </CollapsibleSection>
  );
};

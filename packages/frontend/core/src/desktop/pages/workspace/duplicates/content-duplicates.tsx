import { Button, notify, useConfirmModal } from '@notesgraph/component';
import {
  DocEmbedder,
  findMergeablePairs,
  LocalEmbeddingService,
  type MergeSuggestion,
} from '@notesgraph/core/modules/ai-local';
import { DocsService } from '@notesgraph/core/modules/doc';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useState } from 'react';

import * as styles from './duplicates.css';

/**
 * Duplicates found by *content* similarity (semantic), not shared titles — the
 * complement to the exact-title groups above. Rides the on-device embedding
 * index (findMergeablePairs, body-weighted), so it only appears once local AI
 * is enabled and the model is loaded; otherwise it shows a hint. Scanning is
 * explicit (a pairwise pass over the vector store is not free) rather than on
 * every visit.
 */
export const ContentDuplicates = () => {
  const t = useI18n();
  const docsService = useService(DocsService);
  const embedder = useService(DocEmbedder);
  const embedding = useService(LocalEmbeddingService);
  const workbench = useService(WorkbenchService).workbench;
  const { openConfirmModal } = useConfirmModal();

  const status = useLiveData(embedding.status$);
  const [pairs, setPairs] = useState<MergeSuggestion[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const titleOf = useCallback(
    (id: string) =>
      docsService.list.doc$(id).value?.title$.value?.trim() || 'Untitled',
    [docsService]
  );

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      setPairs(await findMergeablePairs(embedder, 0.82, 20));
    } catch {
      setPairs([]);
    } finally {
      setScanning(false);
    }
  }, [embedder]);

  const combine = useCallback(
    (pair: MergeSuggestion) => {
      // Keep the first doc as the target; merge the second into it.
      const targetTitle = titleOf(pair.aDocId);
      const sourceTitle = titleOf(pair.bDocId);
      openConfirmModal({
        title: t['com.notesgraph.duplicates.content.combineConfirm.title'](),
        description: t[
          'com.notesgraph.duplicates.content.combineConfirm.description'
        ]({ source: sourceTitle, target: targetTitle }),
        confirmText: t['com.notesgraph.duplicates.confirm.confirm'](),
        confirmButtonOptions: { variant: 'primary' },
        onConfirm: async () => {
          try {
            await docsService.mergeDocInto(pair.bDocId, pair.aDocId);
            setPairs(prev =>
              prev
                ? prev.filter(
                    p =>
                      p.aDocId !== pair.bDocId && p.bDocId !== pair.bDocId
                  )
                : prev
            );
            notify.success({
              title: t['com.notesgraph.duplicates.combined']({
                title: targetTitle,
              }),
            });
          } catch {
            notify.error({
              title: t['com.notesgraph.duplicates.combineFailed'](),
            });
          }
        },
      });
    },
    [docsService, openConfirmModal, t, titleOf]
  );

  return (
    <>
      <div className={styles.sectionTitle}>
        {t['com.notesgraph.duplicates.content.title']()}
        {status.state === 'ready' ? (
          <div className={styles.sectionActions}>
            <Button size="default" onClick={scan} loading={scanning}>
              {t['com.notesgraph.duplicates.content.scan']()}
            </Button>
          </div>
        ) : null}
      </div>

      {status.state !== 'ready' ? (
        <div className={styles.contentHint}>
          {status.state === 'loading'
            ? t['com.notesgraph.duplicates.content.loading']()
            : t['com.notesgraph.duplicates.content.disabled']()}
        </div>
      ) : pairs === null ? (
        <div className={styles.contentHint}>
          {t['com.notesgraph.duplicates.content.idle']()}
        </div>
      ) : pairs.length === 0 ? (
        <div className={styles.contentHint}>
          {t['com.notesgraph.duplicates.content.none']()}
        </div>
      ) : (
        <div className={styles.groups}>
          <div className={styles.group}>
            {pairs.map(pair => (
              <div
                key={`${pair.aDocId}:${pair.bDocId}`}
                className={styles.row}
              >
                <div className={styles.pairTitles}>
                  <button
                    className={styles.pairTitle}
                    onClick={() =>
                      workbench.openDoc(pair.aDocId, { at: 'active' })
                    }
                  >
                    {titleOf(pair.aDocId)}
                  </button>
                  <span className={styles.pairArrow}>↔</span>
                  <button
                    className={styles.pairTitle}
                    onClick={() =>
                      workbench.openDoc(pair.bDocId, { at: 'active' })
                    }
                  >
                    {titleOf(pair.bDocId)}
                  </button>
                </div>
                <span className={styles.pairScore}>
                  {Math.round(pair.score * 100)}%
                </span>
                <Button
                  variant="primary"
                  size="default"
                  onClick={() => combine(pair)}
                >
                  {t['com.notesgraph.duplicates.confirm.confirm']()}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

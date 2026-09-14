import { Button, toast, useConfirmModal } from '@notesgraph/component';
import {
  AiBackendService,
  DocEmbedder,
  findMergeablePairs,
  mergeDocs,
  type MergeSuggestion,
} from '@notesgraph/core/modules/ai-local';
import { DocsService } from '@notesgraph/core/modules/doc';
import { PeekViewService } from '@notesgraph/core/modules/peek-view';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useState } from 'react';

import * as styles from './graph.css';

/**
 * On-graph panel that scans the local vector index for near-duplicate notes
 * (merge candidates). Only shown for the on-device backend; clicking a title
 * peeks that doc to compare, and Merge appends one note into the other
 * (the merged note goes to trash — recoverable).
 */
export const GraphRecommendations = () => {
  const backend = useLiveData(useService(AiBackendService).backend$);
  const docEmbedder = useService(DocEmbedder);
  const docsService = useService(DocsService);
  const workspaceService = useService(WorkspaceService);
  const peekView = useService(PeekViewService).peekView;
  const { openConfirmModal } = useConfirmModal();
  const [suggestions, setSuggestions] = useState<MergeSuggestion[] | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  const scan = useCallback(() => {
    setLoading(true);
    findMergeablePairs(docEmbedder)
      .then(setSuggestions)
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false));
  }, [docEmbedder]);

  const title = useCallback(
    (id: string) =>
      docsService.list.docsMap$.value.get(id)?.meta$.value.title?.trim() ||
      'Untitled',
    [docsService]
  );
  const open = useCallback(
    (id: string) => {
      peekView.open({ type: 'doc', docRef: { docId: id } }).catch(() => {});
    },
    [peekView]
  );

  const merge = useCallback(
    (suggestion: MergeSuggestion) => {
      const keepTitle = title(suggestion.aDocId);
      const mergeTitle = title(suggestion.bDocId);
      openConfirmModal({
        title: 'Merge notes?',
        description: `"${mergeTitle}" will be appended into "${keepTitle}" and moved to trash (recoverable there).`,
        cancelText: 'Cancel',
        confirmText: 'Merge',
        onConfirm: async () => {
          try {
            await mergeDocs(
              workspaceService,
              docsService,
              suggestion.aDocId,
              suggestion.bDocId
            );
            // the merged doc is gone — drop every pair that references it
            setSuggestions(
              current =>
                current?.filter(
                  s =>
                    s.aDocId !== suggestion.bDocId &&
                    s.bDocId !== suggestion.bDocId
                ) ?? null
            );
            toast(`Merged "${mergeTitle}" into "${keepTitle}"`);
          } catch (err) {
            console.error('[graph] merge failed', err);
            toast('Merge failed — see console for details');
          }
        },
      });
    },
    [docsService, openConfirmModal, title, workspaceService]
  );

  if (backend !== 'local') return null;

  return (
    <div className={styles.recommendations}>
      <div className={styles.recommendationsHeader}>
        <span>Similar notes</span>
        <Button variant="plain" loading={loading} onClick={scan}>
          Scan
        </Button>
      </div>

      {suggestions && suggestions.length === 0 && !loading ? (
        <div className={styles.recommendationsEmpty}>
          No similar notes found. Index your documents in Settings → On-device
          AI.
        </div>
      ) : null}

      {suggestions?.map(suggestion => (
        <div
          key={suggestion.aDocId + suggestion.bDocId}
          className={styles.recommendationItem}
        >
          <div className={styles.recommendationScore}>
            <span>{Math.round(suggestion.score * 100)}% similar</span>
            <Button
              variant="plain"
              data-testid="merge-suggestion"
              onClick={() => merge(suggestion)}
            >
              Merge
            </Button>
          </div>
          <div className={styles.recommendationPair}>
            <span
              role="button"
              tabIndex={0}
              className={styles.recommendationDoc}
              onClick={() => open(suggestion.aDocId)}
              onKeyDown={event => {
                if (event.key === 'Enter') open(suggestion.aDocId);
              }}
            >
              {title(suggestion.aDocId)}
            </span>
            <span>↔</span>
            <span
              role="button"
              tabIndex={0}
              className={styles.recommendationDoc}
              onClick={() => open(suggestion.bDocId)}
              onKeyDown={event => {
                if (event.key === 'Enter') open(suggestion.bDocId);
              }}
            >
              {title(suggestion.bDocId)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

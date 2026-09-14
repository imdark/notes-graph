import {
  CenterPeekIcon,
  CloseIcon,
  PlusIcon,
  SearchIcon,
} from '@blocksuite/icons/rc';
import { Tooltip, useConfirmModal } from '@notesgraph/component';
import { Menu } from '@notesgraph/component/ui/menu';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { PeekViewService } from '@notesgraph/core/modules/peek-view';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

import { ParentPickerContent } from './parent-picker';
import * as styles from './styles.css';
import {
  useCombineWithDuplicate,
  useCreateTopicParent,
  useCurrentParents,
  useDuplicateCandidates,
  useRemoveParent,
  useSetParent,
  useSuggestedParents,
  useSuggestedTopics,
} from './use-suggest-parent';

// Remember banners the user dismissed for this app session so it doesn't nag on
// every visit to the same doc. Cleared on app restart by design.
const dismissed = new Set<string>();

export const SuggestedParentBanner = ({ docId }: { docId: string }) => {
  const featureFlagService = useService(FeatureFlagService);
  const enabled = useLiveData(
    featureFlagService.flags.enable_suggest_parent.$
  );

  const parents = useCurrentParents(docId);
  const suggestions = useSuggestedParents(docId, 3);
  const topics = useSuggestedTopics(docId, 3);
  const duplicates = useDuplicateCandidates(docId, 2);
  const setParent = useSetParent();
  const createTopic = useCreateTopicParent();
  const removeParent = useRemoveParent();
  const combine = useCombineWithDuplicate();
  const peekView = useService(PeekViewService).peekView;
  const { openConfirmModal } = useConfirmModal();
  const [hidden, setHidden] = useState(() => dismissed.has(docId));

  // A current parent is a real note — let the user peek at it in place
  // (the whole label is the target; the × stays the separate "remove").
  const peekParent = useCallback(
    (parentId: string) => {
      peekView.open({ docRef: { docId: parentId } }).catch(console.error);
    },
    [peekView]
  );

  const excludeIds = useMemo(() => parents.map(p => p.docId), [parents]);

  const handleDismiss = useCallback(() => {
    dismissed.add(docId);
    setHidden(true);
  }, [docId]);

  const handleCombine = useCallback(
    (targetId: string, targetTitle: string) => {
      openConfirmModal({
        title: 'Combine notes?',
        description: `Moves this note’s content into “${targetTitle}” and moves this note to trash (recoverable).`,
        confirmText: 'Combine',
        cancelText: 'Cancel',
        confirmButtonOptions: { variant: 'primary' },
        onConfirm: () => {
          combine(targetId, docId, targetTitle);
        },
      });
    },
    [combine, docId, openConfirmModal]
  );

  const hasParents = parents.length > 0;

  if (
    !enabled ||
    hidden ||
    (!hasParents &&
      suggestions.length === 0 &&
      topics.length === 0 &&
      duplicates.length === 0)
  ) {
    return null;
  }

  return (
    <div className={styles.banner} data-testid="suggested-parent-banner">
      <div className={styles.bannerHeader}>
        <span>{hasParents ? 'Parents' : 'Suggested parent'}</span>
        <div
          role="button"
          aria-label="Dismiss"
          className={styles.dismissButton}
          onClick={handleDismiss}
        >
          <CloseIcon />
        </div>
      </div>

      {/* Another note with the same title — offer to combine into it. */}
      {duplicates.length > 0 ? (
        <div className={styles.group}>
          <div className={styles.groupLabel}>
            Duplicate node? Combine with:
          </div>
          <div className={styles.chips}>
            {duplicates.map(d => (
              <div
                key={d.docId}
                role="button"
                className={styles.chip}
                onClick={() => handleCombine(d.docId, d.title)}
              >
                <span className={styles.chipLabel}>{d.title}</span>
                <span className={styles.chipIcon}>
                  <PlusIcon />
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Current parents — tap the × to unlink (remove one + add another = swap). */}
      {hasParents ? (
        <div className={styles.group}>
          <div className={styles.chips}>
            {parents.map(p => (
              <div key={p.docId} className={styles.chip}>
                <Tooltip content={`Peek at ${p.title || 'Untitled'}`}>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Peek at ${p.title || 'Untitled'}`}
                    data-testid="peek-parent"
                    className={styles.peekLabel}
                    onClick={() => peekParent(p.docId)}
                  >
                    <span className={styles.peekIcon}>
                      <CenterPeekIcon />
                    </span>
                    <span className={styles.chipLabel}>
                      {p.title || 'Untitled'}
                    </span>
                  </span>
                </Tooltip>
                <span
                  role="button"
                  aria-label={`Remove ${p.title || 'parent'}`}
                  className={styles.chipIcon}
                  onClick={() => removeParent(p.docId, docId, p.title)}
                >
                  <CloseIcon />
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Suggestions linking to notes that already exist, plus search. Kept
          visually and verbally separate from the "create new topic" group. */}
      <div className={styles.group}>
        <div className={styles.groupLabel}>
          {hasParents ? 'Add another parent' : 'Link under existing note'}
        </div>
        <div className={styles.chips}>
          {suggestions.map(s => (
            <div
              key={s.docId}
              role="button"
              className={styles.chip}
              onClick={() => setParent(s.docId, docId, s.title)}
            >
              <span className={styles.chipLabel}>{s.title || 'Untitled'}</span>
              <span className={styles.chipIcon}>
                <PlusIcon />
              </span>
            </div>
          ))}
          <Menu
            items={
              <ParentPickerContent
                docId={docId}
                excludeIds={excludeIds}
                onSelect={(parentId, title) => setParent(parentId, docId, title)}
              />
            }
          >
            <div
              role="button"
              className={`${styles.chip} ${styles.addChip}`}
            >
              <span className={styles.chipIcon}>
                <SearchIcon />
              </span>
              <span className={styles.chipLabel}>Search…</span>
            </div>
          </Menu>
        </div>
      </div>

      {/* Topic suggestions — these notes don't exist yet: tapping one creates
          a new topic node and parents this note under it. */}
      {topics.length > 0 ? (
        <div className={styles.group}>
          <div className={styles.groupLabel}>Create new parent</div>
          <div className={styles.chips}>
            {topics.map(topic => (
              <div
                key={topic}
                role="button"
                className={`${styles.chip} ${styles.topicChip}`}
                data-testid="suggested-topic-chip"
                onClick={() => createTopic(topic, docId)}
              >
                <span className={`${styles.chipIcon} ${styles.topicChipIcon}`}>
                  <PlusIcon />
                </span>
                <span className={styles.chipLabel}>{topic}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

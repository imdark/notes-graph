import { Button, Checkbox, notify, useConfirmModal } from '@notesgraph/component';
import { DocsService } from '@notesgraph/core/modules/doc';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

import {
  ViewBody,
  ViewHeader,
  ViewIcon,
  ViewTitle,
} from '../../../../modules/workbench';
import { ContentDuplicates } from './content-duplicates';
import * as styles from './duplicates.css';
import {
  type DuplicateGroup,
  useDuplicateGroups,
} from './use-duplicate-groups';

const GroupCard = ({
  group,
  onOpen,
  onCombine,
}: {
  group: DuplicateGroup;
  onOpen: (id: string) => void;
  onCombine: (group: DuplicateGroup, selectedIds: string[]) => void;
}) => {
  const t = useI18n();
  // Default: every duplicate in the cluster is selected, so the common case
  // (combine them all) is one click.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(group.docs.map(d => d.id))
  );

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedIds = useMemo(
    () => group.docs.filter(d => selected.has(d.id)).map(d => d.id),
    [group.docs, selected]
  );

  return (
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        <span className={styles.groupTitle} title={group.title}>
          {group.title}
        </span>
        <span className={styles.groupCount}>
          {t['com.notesgraph.duplicates.groupCount']({
            count: group.docs.length.toString(),
          })}
        </span>
        <div className={styles.groupActions}>
          <Button
            variant="primary"
            size="default"
            disabled={selectedIds.length < 2}
            onClick={() => onCombine(group, selectedIds)}
          >
            {t['com.notesgraph.duplicates.combine']({
              count: selectedIds.length.toString(),
            })}
          </Button>
        </div>
      </div>
      {group.docs.map(doc => (
        <div
          key={doc.id}
          className={styles.row}
          onClick={() => toggle(doc.id)}
        >
          <Checkbox
            className={styles.checkbox}
            checked={selected.has(doc.id)}
            onChange={() => toggle(doc.id)}
            onClick={e => e.stopPropagation()}
          />
          <div className={styles.rowText}>
            <span className={styles.rowTitle}>{doc.title || 'Untitled'}</span>
          </div>
          <button
            className={styles.openLink}
            onClick={e => {
              e.stopPropagation();
              onOpen(doc.id);
            }}
          >
            {t['com.notesgraph.duplicates.open']()}
          </button>
        </div>
      ))}
    </div>
  );
};

const DuplicatesPage = () => {
  const t = useI18n();
  const docsService = useService(DocsService);
  const workbench = useService(WorkbenchService).workbench;
  const { openConfirmModal } = useConfirmModal();

  const groups = useDuplicateGroups();

  const onOpen = useCallback(
    (id: string) => {
      workbench.openDoc(id, { at: 'active' });
    },
    [workbench]
  );

  const onCombine = useCallback(
    (group: DuplicateGroup, selectedIds: string[]) => {
      if (selectedIds.length < 2) return;
      // Keep the oldest selected doc (docs are oldest-first); merge the rest
      // into it. Each source is appended then trashed by mergeDocInto.
      const [keepId, ...sourceIds] = selectedIds;
      const keepTitle =
        group.docs.find(d => d.id === keepId)?.title || group.title;

      openConfirmModal({
        title: t['com.notesgraph.duplicates.confirm.title'](),
        description: t['com.notesgraph.duplicates.confirm.description']({
          count: sourceIds.length.toString(),
          title: keepTitle,
        }),
        confirmText: t['com.notesgraph.duplicates.confirm.confirm'](),
        confirmButtonOptions: { variant: 'primary' },
        onConfirm: async () => {
          try {
            for (const sourceId of sourceIds) {
              await docsService.mergeDocInto(sourceId, keepId);
            }
            notify.success({
              title: t['com.notesgraph.duplicates.combined']({
                title: keepTitle,
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
    [docsService, openConfirmModal, t]
  );

  const onMergeAll = useCallback(() => {
    if (groups.length === 0) return;
    // Snapshot the groups at click time; each is merged into its oldest doc.
    const snapshot = groups;
    const redundant = snapshot.reduce((n, g) => n + g.docs.length - 1, 0);

    openConfirmModal({
      title: t['com.notesgraph.duplicates.mergeAll.title'](),
      description: t['com.notesgraph.duplicates.mergeAll.description']({
        count: redundant.toString(),
        groups: snapshot.length.toString(),
      }),
      confirmText: t['com.notesgraph.duplicates.mergeAll.confirm'](),
      confirmButtonOptions: { variant: 'primary' },
      onConfirm: async () => {
        try {
          for (const group of snapshot) {
            const [keepId, ...sourceIds] = group.docs.map(d => d.id);
            for (const sourceId of sourceIds) {
              await docsService.mergeDocInto(sourceId, keepId);
            }
          }
          notify.success({
            title: t['com.notesgraph.duplicates.mergeAll.done']({
              count: redundant.toString(),
            }),
          });
        } catch {
          notify.error({
            title: t['com.notesgraph.duplicates.combineFailed'](),
          });
        }
      },
    });
  }, [groups, docsService, openConfirmModal, t]);

  return (
    <>
      <ViewTitle title={t['com.notesgraph.duplicates.title']()} />
      <ViewIcon icon="allDocs" />
      <ViewHeader>
        {groups.length > 0 ? (
          <div className={styles.headerBar}>
            <Button variant="primary" size="default" onClick={onMergeAll}>
              {t['com.notesgraph.duplicates.mergeAll']()}
            </Button>
          </div>
        ) : null}
      </ViewHeader>
      <ViewBody>
        <div className={styles.body}>
          <div className={styles.sectionTitle}>
            {t['com.notesgraph.duplicates.sameTitle']()}
          </div>
          {groups.length === 0 ? (
            <div className={styles.contentHint}>
              {t['com.notesgraph.duplicates.empty']()}
            </div>
          ) : (
            <div className={styles.groups}>
              {groups.map(group => (
                <GroupCard
                  key={group.key}
                  group={group}
                  onOpen={onOpen}
                  onCombine={onCombine}
                />
              ))}
            </div>
          )}
          <ContentDuplicates />
        </div>
      </ViewBody>
    </>
  );
};

export const Component = () => {
  return <DuplicatesPage />;
};

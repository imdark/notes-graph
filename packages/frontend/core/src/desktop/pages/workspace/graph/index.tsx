import { Input, notify, useConfirmModal } from '@notesgraph/component';
import { type DocRecord, DocsService } from '@notesgraph/core/modules/doc';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { useCallback, useState } from 'react';

import {
  ViewBody,
  ViewHeader,
  ViewIcon,
  ViewTitle,
} from '../../../../modules/workbench';
import * as styles from './graph.css';
import { GraphRecommendations } from './graph-recommendations';
import { GraphView } from './graph-view';
import { useGraphData } from './use-graph-data';
import { useGraphNodePages } from './use-graph-node-pages';
import { useGraphNodeSort } from './use-graph-node-sort';
import { useGraphViewport } from './use-graph-viewport';
import { usePinnedPositions } from './use-pinned-positions';

const GraphPage = () => {
  const t = useI18n();
  const data = useGraphData();
  const [query, setQuery] = useState('');
  const { pinned, pinNode, unpinNode } = usePinnedPositions();
  const { viewport, viewportLoaded, saveViewport } = useGraphViewport();
  const { pages, pagesLoaded, setNodePage } = useGraphNodePages();
  const { sortKeys, sortKeysLoaded, setSortKey } = useGraphNodeSort();

  const docsService = useService(DocsService);
  const { openConfirmModal } = useConfirmModal();
  const handleTrash = useCallback(
    (ids: string[]) => {
      const records: DocRecord[] = [];
      for (const id of ids) {
        const record = docsService.list.doc$(id).value;
        if (record) records.push(record);
      }
      const count = records.length;
      if (count === 0) return;
      openConfirmModal({
        title: t['com.notesgraph.moveToTrash.confirmModal.title'](),
        description: `Move ${count} doc${count > 1 ? 's' : ''} to trash?`,
        cancelText: t['com.notesgraph.confirmModal.button.cancel'](),
        confirmText: t.Delete(),
        confirmButtonOptions: { variant: 'error' },
        onConfirm: () => {
          for (const record of records) record.moveToTrash();
          notify.success({
            title: `Moved ${count} doc${count > 1 ? 's' : ''} to trash`,
          });
        },
      });
    },
    [docsService, openConfirmModal, t]
  );
  const handleDeleteNode = useCallback(
    (id: string, childIds: string[], parentId: string | null) => {
      const record = docsService.list.doc$(id).value;
      if (!record) return;
      const childCount = childIds.length;
      const willReparent = parentId != null && childCount > 0;
      openConfirmModal({
        title: t['com.notesgraph.moveToTrash.confirmModal.title'](),
        description: willReparent
          ? `Move this doc to trash? Its ${childCount} child${
              childCount > 1 ? 'ren' : ''
            } will be linked to its parent.`
          : 'Move this doc to trash?',
        cancelText: t['com.notesgraph.confirmModal.button.cancel'](),
        confirmText: t.Delete(),
        confirmButtonOptions: { variant: 'error' },
        onConfirm: () => {
          // Re-home the deleted node's children under its parent so the
          // subtree stays connected (the parent gains a reference to each).
          if (parentId) {
            for (const childId of childIds) {
              docsService.addLinkedDoc(parentId, childId).catch(console.error);
            }
          }
          record.moveToTrash();
          notify.success({ title: 'Moved doc to trash' });
        },
      });
    },
    [docsService, openConfirmModal, t]
  );
  const handleLink = useCallback(
    (draggedId: string, targetId: string) => {
      // The dragged doc "adds itself" to the drop target: insert a reference to
      // the dragged doc inside the target doc. The new edge appears once the
      // doc re-indexes.
      docsService
        .addLinkedDoc(targetId, draggedId)
        .then(() =>
          notify.success({ title: t['com.notesgraph.graph.linked']() })
        )
        .catch(() =>
          notify.error({ title: t['com.notesgraph.graph.linkFailed']() })
        );
    },
    [docsService, t]
  );
  const handleCreateNode = useCallback(
    () => docsService.createDoc().id,
    [docsService]
  );

  return (
    <>
      <ViewTitle title={t['com.notesgraph.workspaceSubPath.graph']()} />
      <ViewIcon icon="graph" />
      <ViewHeader>
        <div className={styles.header}>
          <Input
            className={styles.searchInput}
            placeholder={t['com.notesgraph.graph.search.placeholder']()}
            value={query}
            onChange={setQuery}
          />
          <span className={styles.count}>
            {t['com.notesgraph.graph.stats']({
              docs: String(data.nodes.length),
              links: String(data.links.length),
            })}
          </span>
        </div>
      </ViewHeader>
      <ViewBody>
        {viewportLoaded && pagesLoaded && sortKeysLoaded ? (
          <GraphView
            data={data}
            query={query}
            pinned={pinned}
            onPin={pinNode}
            onUnpin={unpinNode}
            onLink={handleLink}
            initialViewport={viewport}
            onViewportChange={saveViewport}
            initialNodePages={pages}
            onNodePageChange={setNodePage}
            onTrash={handleTrash}
            onDeleteNode={handleDeleteNode}
            onCreateNode={handleCreateNode}
            initialSortKeys={sortKeys}
            onSortKeyChange={setSortKey}
          />
        ) : null}
        <GraphRecommendations />
      </ViewBody>
    </>
  );
};

export const Component = () => {
  return <GraphPage />;
};

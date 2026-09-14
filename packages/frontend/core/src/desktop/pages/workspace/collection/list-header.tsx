import { ViewLayersIcon } from '@blocksuite/icons/rc';
import type { DocMode } from '@blocksuite/notesgraph/model';
import { Button, useConfirmModal } from '@notesgraph/component';
import { usePageHelper } from '@notesgraph/core/blocksuite/block-suite-page-list/utils';
import { PageListNewPageButton } from '@notesgraph/core/components/page-list';
import {
  type Collection,
  CollectionService,
} from '@notesgraph/core/modules/collection';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import type { DocRecord } from '@notesgraph/core/modules/doc';
import { WorkbenchLink } from '@notesgraph/core/modules/workbench';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useServices } from '@notesgraph/infra';
import track from '@notesgraph/track';
import { useCallback } from 'react';

import * as styles from './index.css';

export const CollectionListHeader = ({
  collection,
}: {
  collection: Collection;
}) => {
  const t = useI18n();
  const { collectionService, workspaceService, workspaceDialogService } =
    useServices({
      CollectionService,
      WorkspaceService,
      WorkspaceDialogService,
    });

  const handleEdit = useCallback(() => {
    track.collection.collection.$.editCollection();
    workspaceDialogService.open('collection-editor', {
      collectionId: collection.id,
    });
  }, [collection, workspaceDialogService]);

  const workspace = workspaceService.workspace;
  const { createEdgeless, createPage } = usePageHelper(workspace.docCollection);
  const { openConfirmModal } = useConfirmModal();
  const name = useLiveData(collection.name$);

  const createAndAddDocument = useCallback(
    (createDocumentFn: () => DocRecord) => {
      const newDoc = createDocumentFn();
      collectionService.addDocToCollection(collection.id, newDoc.id);
    },
    [collection.id, collectionService]
  );

  const onConfirmAddDocument = useCallback(
    (createDocumentFn: () => DocRecord) => {
      openConfirmModal({
        title: t['com.notesgraph.collection.add-doc.confirm.title'](),
        description:
          t['com.notesgraph.collection.add-doc.confirm.description'](),
        cancelText: t['Cancel'](),
        confirmText: t['Confirm'](),
        confirmButtonOptions: {
          variant: 'primary',
        },
        onConfirm: () => createAndAddDocument(createDocumentFn),
      });
    },
    [openConfirmModal, t, createAndAddDocument]
  );

  const createPageModeDoc = useCallback(
    () => createPage('page' as DocMode),
    [createPage]
  );

  const onCreateEdgeless = useCallback(
    () => onConfirmAddDocument(createEdgeless),
    [createEdgeless, onConfirmAddDocument]
  );
  const onCreatePage = useCallback(() => {
    onConfirmAddDocument(createPageModeDoc);
  }, [createPageModeDoc, onConfirmAddDocument]);
  const onCreateDoc = useCallback(() => {
    onConfirmAddDocument(createPage);
  }, [createPage, onConfirmAddDocument]);

  return (
    <header className={styles.collectionHeader}>
      <div className={styles.breadcrumb}>
        <div className={styles.breadcrumbItem}>
          <WorkbenchLink to="/collection" className={styles.breadcrumbLink}>
            {t['com.notesgraph.collections.header']()}
          </WorkbenchLink>
        </div>
        <div className={styles.breadcrumbSeparator}>/</div>
        <div className={styles.breadcrumbItem} data-active={true}>
          <ViewLayersIcon className={styles.breadcrumbIcon} />
          {name}
        </div>
      </div>

      <div className={styles.headerActions}>
        <Button onClick={handleEdit}>{t['Edit']()}</Button>
        <PageListNewPageButton
          size="small"
          data-testid="new-page-button-trigger"
          onCreateDoc={onCreateDoc}
          onCreateEdgeless={onCreateEdgeless}
          onCreatePage={onCreatePage}
        >
          <div className={styles.newPageButtonText}>{t['New Page']()}</div>
        </PageListNewPageButton>
      </div>
    </header>
  );
};

import {
  DeleteIcon,
  DuplicateIcon,
  FolderIcon,
  InformationIcon,
  LinkedPageIcon,
  OpenInNewIcon,
  PlusIcon,
  SplitViewIcon,
} from '@blocksuite/icons/rc';
import {
  IconButton,
  MenuItem,
  MenuSeparator,
  toast,
  useConfirmModal,
} from '@notesgraph/component';
import { usePageHelper } from '@notesgraph/core/blocksuite/block-suite-page-list/utils';
import { Guard } from '@notesgraph/core/components/guard';
import { useAppSettingHelper } from '@notesgraph/core/components/hooks/notesgraph/use-app-setting-helper';
import { useBlockSuiteMetaHelper } from '@notesgraph/core/components/hooks/notesgraph/use-block-suite-meta-helper';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { IsFavoriteIcon } from '@notesgraph/core/components/pure/icons';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { DocsService } from '@notesgraph/core/modules/doc';
import { DocsSearchService } from '@notesgraph/core/modules/docs-search';
import { CompatibleFavoriteItemsAdapter } from '@notesgraph/core/modules/favorite';
import { NavigationPanelService } from '@notesgraph/core/modules/navigation-panel';
import { GuardService } from '@notesgraph/core/modules/permissions';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useServices } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { useCallback, useMemo, useState } from 'react';

import type { NodeOperation } from '../../tree/types';

export const useNavigationPanelDocNodeOperations = (
  docId: string,
  options: {
    openInfoModal: () => void;
    openNodeCollapsed: () => void;
  }
): NodeOperation[] => {
  const t = useI18n();
  const {
    workbenchService,
    workspaceService,
    workspaceDialogService,
    docsService,
    docsSearchService,
    navigationPanelService,
    compatibleFavoriteItemsAdapter,
    guardService,
  } = useServices({
    DocsService,
    DocsSearchService,
    NavigationPanelService,
    WorkbenchService,
    WorkspaceService,
    WorkspaceDialogService,
    CompatibleFavoriteItemsAdapter,
    GuardService,
  });
  const { openConfirmModal } = useConfirmModal();

  const [addLinkedPageLoading, setAddLinkedPageLoading] = useState(false);
  const docRecord = useLiveData(docsService.list.doc$(docId));
  const { appSettings } = useAppSettingHelper();

  const { createPage } = usePageHelper(
    workspaceService.workspace.docCollection
  );

  const favorite = useLiveData(
    useMemo(() => {
      return compatibleFavoriteItemsAdapter.isFavorite$(docId, 'doc');
    }, [docId, compatibleFavoriteItemsAdapter])
  );

  const { duplicate } = useBlockSuiteMetaHelper();
  const handleDuplicate = useCallback(() => {
    duplicate(docId, true);
    track.$.navigationPanel.docs.createDoc();
  }, [docId, duplicate]);
  const handleOpenInfoModal = useCallback(() => {
    track.$.docInfoPanel.$.open();
    options.openInfoModal();
  }, [options]);

  const handleMoveToTrash = useCallback(() => {
    if (!docRecord) {
      return;
    }
    openConfirmModal({
      title: t['com.notesgraph.moveToTrash.title'](),
      description: t['com.notesgraph.moveToTrash.confirmModal.description']({
        title: docRecord.title$.value,
      }),
      confirmText: t['com.notesgraph.moveToTrash.confirmModal.confirm'](),
      cancelText: t['com.notesgraph.moveToTrash.confirmModal.cancel'](),
      confirmButtonOptions: {
        variant: 'error',
      },
      onConfirm() {
        docRecord.moveToTrash();
        track.$.navigationPanel.docs.deleteDoc({
          control: 'button',
        });
        toast(t['com.notesgraph.toastMessage.movedTrash']());
      },
    });
  }, [docRecord, openConfirmModal, t]);

  const handleOpenInNewTab = useCallback(() => {
    workbenchService.workbench.openDoc(docId, {
      at: 'new-tab',
    });
    track.$.navigationPanel.docs.openDoc();
    track.$.navigationPanel.organize.openInNewTab({
      type: 'doc',
    });
  }, [docId, workbenchService]);

  const handleOpenInSplitView = useCallback(() => {
    workbenchService.workbench.openDoc(docId, {
      at: 'beside',
    });
    track.$.navigationPanel.docs.openDoc();
    track.$.navigationPanel.organize.openInSplitView({
      type: 'doc',
    });
  }, [docId, workbenchService.workbench]);

  const handleAddLinkedPage = useAsyncCallback(async () => {
    setAddLinkedPageLoading(true);
    try {
      const canEdit = await guardService.can('Doc_Update', docId);
      if (!canEdit) {
        toast(t['com.notesgraph.no-permission']());
        return;
      }
      // Create without navigating yet — createPage()'s default navigation
      // would flip the active doc before the optimistic link below is
      // registered, so the sidebar's reveal-active-note effect could still
      // run its first pass with no parent info. Register the link, then
      // navigate, so both land in the same render.
      const newDoc = createPage(undefined, { show: false });
      navigationPanelService.addOptimisticLink(docId, newDoc.id);
      workbenchService.workbench.openDoc(newDoc.id);
      // TODO: handle timeout & error
      await docsService.addLinkedDoc(docId, newDoc.id);
      track.$.navigationPanel.docs.createDoc({ control: 'linkDoc' });
      track.$.navigationPanel.docs.linkDoc({ control: 'createDoc' });
      options.openNodeCollapsed();

      // Boost this doc's indexing priority so the real link surfaces
      // quickly. The optimistic entry itself is cleared centrally in
      // sections/notes' tree computation, against the exact `edges` value
      // it renders from, once that already contains the real link (see the
      // comment there for why that's the only race-free place to do it).
      // This timeout is just a safety net so a stuck or failed indexing
      // pass doesn't leave the optimistic entry, or the priority boost,
      // around forever.
      const undoPriority = docsSearchService.indexer.addPriority(docId, 10);
      setTimeout(() => {
        undoPriority();
        navigationPanelService.clearOptimisticLink(newDoc.id);
      }, 30000);
    } finally {
      setAddLinkedPageLoading(false);
    }
  }, [
    createPage,
    guardService,
    docId,
    docsService,
    docsSearchService,
    navigationPanelService,
    workbenchService,
    options,
    t,
  ]);

  const handleConvertToProject = useCallback(() => {
    workspaceDialogService.open('convert-to-project', { docId });
  }, [docId, workspaceDialogService]);

  const handleToggleFavoriteDoc = useCallback(() => {
    compatibleFavoriteItemsAdapter.toggle(docId, 'doc');
    track.$.navigationPanel.organize.toggleFavorite({
      type: 'doc',
    });
  }, [docId, compatibleFavoriteItemsAdapter]);

  return useMemo(
    () => [
      ...(appSettings.showLinkedDocInSidebar
        ? [
            {
              index: 0,
              inline: true,
              view: (
                <IconButton
                  size="16"
                  icon={<PlusIcon />}
                  tooltip={t[
                    'com.notesgraph.rootAppSidebar.explorer.doc-add-tooltip'
                  ]()}
                  onClick={handleAddLinkedPage}
                  loading={addLinkedPageLoading}
                  disabled={addLinkedPageLoading}
                />
              ),
            },
          ]
        : []),
      {
        index: 50,
        view: (
          <MenuItem
            prefixIcon={<InformationIcon />}
            onClick={handleOpenInfoModal}
          >
            {t['com.notesgraph.page-properties.page-info.view']()}
          </MenuItem>
        ),
      },
      {
        index: 99,
        view: (
          <Guard docId={docId} permission="Doc_Update">
            {canEdit => (
              <MenuItem
                prefixIcon={<LinkedPageIcon />}
                onClick={handleAddLinkedPage}
                disabled={!canEdit}
              >
                {t['com.notesgraph.page-operation.add-linked-page']()}
              </MenuItem>
            )}
          </Guard>
        ),
      },
      {
        index: 99,
        view: (
          <MenuItem prefixIcon={<DuplicateIcon />} onClick={handleDuplicate}>
            {t['com.notesgraph.header.option.duplicate']()}
          </MenuItem>
        ),
      },
      {
        index: 99,
        view: (
          <MenuItem prefixIcon={<OpenInNewIcon />} onClick={handleOpenInNewTab}>
            {t['com.notesgraph.workbench.tab.page-menu-open']()}
          </MenuItem>
        ),
      },
      {
        index: 100,
        view: (
          <MenuItem
            prefixIcon={<SplitViewIcon />}
            onClick={handleOpenInSplitView}
          >
            {t['com.notesgraph.workbench.split-view.page-menu-open']()}
          </MenuItem>
        ),
      },
      {
        index: 150,
        view: (
          <MenuItem prefixIcon={<FolderIcon />} onClick={handleConvertToProject}>
            {t['com.notesgraph.projects.convert-to-project.menu-item']()}
          </MenuItem>
        ),
      },
      {
        index: 199,
        view: (
          <MenuItem
            prefixIcon={<IsFavoriteIcon favorite={favorite} />}
            onClick={handleToggleFavoriteDoc}
          >
            {favorite
              ? t['com.notesgraph.favoritePageOperation.remove']()
              : t['com.notesgraph.favoritePageOperation.add']()}
          </MenuItem>
        ),
      },
      {
        index: 9999,
        view: <MenuSeparator key="menu-separator" />,
      },
      {
        index: 10000,
        view: (
          <Guard docId={docId} permission="Doc_Trash">
            {canMoveToTrash => (
              <MenuItem
                type={'danger'}
                prefixIcon={<DeleteIcon />}
                onClick={handleMoveToTrash}
                disabled={!canMoveToTrash}
              >
                {t['com.notesgraph.moveToTrash.title']()}
              </MenuItem>
            )}
          </Guard>
        ),
      },
    ],
    [
      addLinkedPageLoading,
      appSettings.showLinkedDocInSidebar,
      docId,
      favorite,
      handleAddLinkedPage,
      handleConvertToProject,
      handleDuplicate,
      handleMoveToTrash,
      handleOpenInNewTab,
      handleOpenInSplitView,
      handleOpenInfoModal,
      handleToggleFavoriteDoc,
      t,
    ]
  );
};

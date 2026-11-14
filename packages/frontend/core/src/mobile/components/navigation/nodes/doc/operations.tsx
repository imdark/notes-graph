import {
  DeleteIcon,
  DuplicateIcon,
  InformationIcon,
  LinkedPageIcon,
  OpenInNewIcon,
} from '@blocksuite/icons/rc';
import {
  MenuItem,
  MenuSeparator,
  MenuSub,
  toast,
  useConfirmModal,
} from '@notesgraph/component';
import { usePageHelper } from '@notesgraph/core/blocksuite/block-suite-page-list/utils';
import { Guard } from '@notesgraph/core/components/guard';
import { useBlockSuiteMetaHelper } from '@notesgraph/core/components/hooks/notesgraph/use-block-suite-meta-helper';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { IsFavoriteIcon } from '@notesgraph/core/components/pure/icons';
import type { NodeOperation } from '@notesgraph/core/desktop/components/navigation-panel';
import { DocsService } from '@notesgraph/core/modules/doc';
import { DocsSearchService } from '@notesgraph/core/modules/docs-search';
import { CompatibleFavoriteItemsAdapter } from '@notesgraph/core/modules/favorite';
import { NavigationPanelService } from '@notesgraph/core/modules/navigation-panel';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { preventDefault } from '@notesgraph/core/utils';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService, useServices } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { useCallback, useMemo } from 'react';

import { DocFrameScope, DocInfoSheet } from '../../../doc-info';
import { DocRenameSubMenu } from './dialog';

export const useNavigationPanelDocNodeOperations = (
  docId: string,
  options: {
    openNodeCollapsed: () => void;
  }
) => {
  const t = useI18n();
  const {
    workbenchService,
    workspaceService,
    docsService,
    docsSearchService,
    navigationPanelService,
    compatibleFavoriteItemsAdapter,
  } = useServices({
    DocsService,
    DocsSearchService,
    NavigationPanelService,
    WorkbenchService,
    WorkspaceService,
    CompatibleFavoriteItemsAdapter,
  });

  const { openConfirmModal } = useConfirmModal();

  const docRecord = useLiveData(docsService.list.doc$(docId));

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
    track.$.navigationPanel.organize.openInNewTab({
      type: 'doc',
    });
  }, [docId, workbenchService]);

  const handleOpenInSplitView = useCallback(() => {
    workbenchService.workbench.openDoc(docId, {
      at: 'beside',
    });
    track.$.navigationPanel.organize.openInSplitView({
      type: 'doc',
    });
  }, [docId, workbenchService.workbench]);

  const handleAddLinkedPage = useAsyncCallback(async () => {
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

    // Boost this doc's indexing priority so the real link surfaces quickly.
    // If a consumer ever merges optimisticLinks$ on mobile (none does
    // today — see the note in nodes/doc/index.tsx), it should clear the
    // entry centrally against its own rendered edges, the same way
    // sections/notes does on desktop, rather than racing a separate
    // indexer query here. This timeout is just a safety net so a stuck or
    // failed indexing pass doesn't leave the optimistic entry, or the
    // priority boost, around forever.
    const undoPriority = docsSearchService.indexer.addPriority(docId, 10);
    setTimeout(() => {
      undoPriority();
      navigationPanelService.clearOptimisticLink(newDoc.id);
    }, 30000);
  }, [
    createPage,
    docId,
    docsService,
    docsSearchService,
    navigationPanelService,
    workbenchService,
    options,
  ]);

  const handleToggleFavoriteDoc = useCallback(() => {
    compatibleFavoriteItemsAdapter.toggle(docId, 'doc');
    track.$.navigationPanel.organize.toggleFavorite({
      type: 'doc',
    });
  }, [docId, compatibleFavoriteItemsAdapter]);

  const handleRename = useAsyncCallback(
    async (newName: string) => {
      await docsService.changeDocTitle(docId, newName);
      track.$.navigationPanel.organize.renameOrganizeItem({ type: 'doc' });
    },
    [docId, docsService]
  );

  return useMemo(
    () => ({
      favorite,
      handleAddLinkedPage,
      handleDuplicate,
      handleToggleFavoriteDoc,
      handleOpenInSplitView,
      handleOpenInNewTab,
      handleMoveToTrash,
      handleRename,
    }),
    [
      favorite,
      handleAddLinkedPage,
      handleDuplicate,
      handleMoveToTrash,
      handleOpenInNewTab,
      handleOpenInSplitView,
      handleRename,
      handleToggleFavoriteDoc,
    ]
  );
};

type DocNodeMenuOptions = {
  openInfoModal: () => void;
  openNodeCollapsed: () => void;
};

type DocNodeMenuItemKind =
  | 'rename'
  | 'info'
  | 'add-linked-page'
  | 'duplicate'
  | 'open-in-new-tab'
  | 'favorite'
  | 'trash';

/**
 * One entry of a doc row's menu. The operations hook runs here, so it costs
 * nothing until the menu opens: MobileMenu only mounts its items inside the
 * open sheet. Running it in every row (twice, with a subscription to every
 * doc's title) was most of the cost of mounting the Home tree.
 */
const DocNodeMenuItem = ({
  docId,
  options,
  kind,
}: {
  docId: string;
  options: DocNodeMenuOptions;
  kind: DocNodeMenuItemKind;
}) => {
  const t = useI18n();
  const {
    favorite,
    handleAddLinkedPage,
    handleDuplicate,
    handleToggleFavoriteDoc,
    handleOpenInNewTab,
    handleMoveToTrash,
    handleRename,
  } = useNavigationPanelDocNodeOperations(docId, options);

  const docService = useService(DocsService);
  const docRecord = useLiveData(docService.list.doc$(docId));
  const title = useLiveData(docRecord?.title$);

  switch (kind) {
    case 'rename':
      return (
        <Guard docId={docId} permission="Doc_Update">
          {canEdit => (
            <DocRenameSubMenu
              onConfirm={handleRename}
              initialName={title}
              disabled={!canEdit}
            />
          )}
        </Guard>
      );
    case 'info':
      return (
        <MenuSub
          triggerOptions={{
            prefixIcon: <InformationIcon />,
            onClick: preventDefault,
          }}
          title={title ?? t['unnamed']()}
          items={
            <DocFrameScope docId={docId}>
              <DocInfoSheet docId={docId} />
            </DocFrameScope>
          }
        >
          <span>{t['com.notesgraph.page-properties.page-info.view']()}</span>
        </MenuSub>
      );
    case 'add-linked-page':
      return (
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
      );
    case 'duplicate':
      return (
        <MenuItem prefixIcon={<DuplicateIcon />} onClick={handleDuplicate}>
          {t['com.notesgraph.header.option.duplicate']()}
        </MenuItem>
      );
    case 'open-in-new-tab':
      return (
        <MenuItem prefixIcon={<OpenInNewIcon />} onClick={handleOpenInNewTab}>
          {t['com.notesgraph.workbench.tab.page-menu-open']()}
        </MenuItem>
      );
    case 'favorite':
      return (
        <MenuItem
          prefixIcon={<IsFavoriteIcon favorite={favorite} />}
          onClick={handleToggleFavoriteDoc}
        >
          {favorite
            ? t['com.notesgraph.favoritePageOperation.remove']()
            : t['com.notesgraph.favoritePageOperation.add']()}
        </MenuItem>
      );
    case 'trash':
      return (
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
      );
  }
};

export const useNavigationPanelDocNodeOperationsMenu = (
  docId: string,
  options: DocNodeMenuOptions
): NodeOperation[] => {
  return useMemo(() => {
    const item = (kind: DocNodeMenuItemKind) => (
      <DocNodeMenuItem docId={docId} options={options} kind={kind} />
    );
    return [
      { index: 10, view: item('rename') },
      { index: 11, view: <MenuSeparator /> },
      { index: 50, view: item('info') },
      { index: 97, view: item('add-linked-page') },
      { index: 98, view: item('duplicate') },
      { index: 99, view: item('open-in-new-tab') },
      { index: 199, view: item('favorite') },
      { index: 9999, view: <MenuSeparator key="menu-separator" /> },
      { index: 10000, view: item('trash') },
    ];
  }, [docId, options]);
};

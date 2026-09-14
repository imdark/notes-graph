import {
  DeleteIcon,
  OpenInNewIcon,
  ResetIcon,
  SplitViewIcon,
} from '@blocksuite/icons/rc';
import {
  Checkbox,
  IconButton,
  type IconButtonProps,
  toast,
  useConfirmModal,
} from '@notesgraph/component';
import type { DocRecord } from '@notesgraph/core/modules/doc';
import { CompatibleFavoriteItemsAdapter } from '@notesgraph/core/modules/favorite';
import { GuardService } from '@notesgraph/core/modules/permissions';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { UserFriendlyError } from '@notesgraph/error';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import track from '@notesgraph/track';
import { memo, useCallback, useContext } from 'react';

import { useBlockSuiteMetaHelper } from '../../hooks/notesgraph/use-block-suite-meta-helper';
import { IsFavoriteIcon } from '../../pure/icons';
import { DocExplorerContext } from '../context';

export interface QuickActionProps extends IconButtonProps {
  doc: DocRecord;
}

export const QuickFavorite = memo(function QuickFavorite({
  doc,
  onClick,
  ...iconButtonProps
}: QuickActionProps) {
  const contextValue = useContext(DocExplorerContext);
  const quickFavorite = useLiveData(contextValue.quickFavorite$);

  const favAdapter = useService(CompatibleFavoriteItemsAdapter);
  const favourite = useLiveData(favAdapter.isFavorite$(doc.id, 'doc'));

  const toggleFavorite = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      e.stopPropagation();
      e.preventDefault();
      track.allDocs.list.docMenu.toggleFavorite();
      favAdapter.toggle(doc.id, 'doc');
    },
    [doc.id, favAdapter, onClick]
  );

  if (!quickFavorite) {
    return null;
  }

  return (
    <IconButton
      icon={<IsFavoriteIcon favorite={favourite} />}
      onClick={toggleFavorite}
      data-testid="doc-list-operation-favorite"
      {...iconButtonProps}
    />
  );
});

export const QuickTab = memo(function QuickTab({
  doc,
  onClick,
  ...iconButtonProps
}: QuickActionProps) {
  const contextValue = useContext(DocExplorerContext);
  const quickTab = useLiveData(contextValue.quickTab$);
  const workbench = useService(WorkbenchService).workbench;
  const onOpenInNewTab = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      e.stopPropagation();
      e.preventDefault();
      track.allDocs.list.doc.openDoc();
      track.allDocs.list.docMenu.openInNewTab();
      workbench.openDoc(doc.id, { at: 'new-tab' });
    },
    [doc.id, onClick, workbench]
  );

  if (!quickTab) {
    return null;
  }

  return (
    <IconButton
      onClick={onOpenInNewTab}
      icon={<OpenInNewIcon />}
      {...iconButtonProps}
    />
  );
});

export const QuickSplit = memo(function QuickSplit({
  doc,
  onClick,
  ...iconButtonProps
}: QuickActionProps) {
  const contextValue = useContext(DocExplorerContext);
  const quickSplit = useLiveData(contextValue.quickSplit$);
  const workbench = useService(WorkbenchService).workbench;

  const onOpenInSplitView = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      e.stopPropagation();
      e.preventDefault();
      track.allDocs.list.doc.openDoc();
      track.allDocs.list.docMenu.openInSplitView();
      workbench.openDoc(doc.id, { at: 'tail' });
    },
    [doc.id, onClick, workbench]
  );

  if (!quickSplit) {
    return null;
  }

  return (
    <IconButton
      onClick={onOpenInSplitView}
      icon={<SplitViewIcon />}
      {...iconButtonProps}
    />
  );
});

export const QuickDelete = memo(function QuickDelete({
  doc,
  onClick,
  ...iconButtonProps
}: QuickActionProps) {
  const t = useI18n();
  const { openConfirmModal } = useConfirmModal();
  const contextValue = useContext(DocExplorerContext);
  const guardService = useService(GuardService);
  const quickTrash = useLiveData(contextValue.quickTrash$);

  const onMoveToTrash = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      e.stopPropagation();
      e.preventDefault();
      if (!doc) {
        return;
      }

      track.allDocs.list.docMenu.deleteDoc();
      openConfirmModal({
        title: t['com.notesgraph.moveToTrash.confirmModal.title'](),
        description: t['com.notesgraph.moveToTrash.confirmModal.description']({
          title: doc.title$.value || t['Untitled'](),
        }),
        cancelText: t['com.notesgraph.confirmModal.button.cancel'](),
        confirmText: t.Delete(),
        confirmButtonOptions: {
          variant: 'error',
        },
        onConfirm: async () => {
          try {
            const canTrash = await guardService.can('Doc_Trash', doc.id);
            if (!canTrash) {
              toast(t['com.notesgraph.no-permission']());
              return;
            }
            doc.moveToTrash();
          } catch (error) {
            console.error(error);
            const userFriendlyError = UserFriendlyError.fromAny(error);
            toast(t[`error.${userFriendlyError.name}`](userFriendlyError.data));
          }
        },
      });
    },
    [doc, guardService, onClick, openConfirmModal, t]
  );

  if (!quickTrash) {
    return null;
  }

  return (
    <IconButton
      onClick={onMoveToTrash}
      icon={<DeleteIcon />}
      variant="danger"
      data-testid="doc-list-operation-trash"
      {...iconButtonProps}
    />
  );
});

export const QuickSelect = memo(function QuickSelect({
  doc,
  onClick,
  ...iconButtonProps
}: QuickActionProps) {
  const contextValue = useContext(DocExplorerContext);
  const quickSelect = useLiveData(contextValue.quickSelect$);
  const selectedDocIds = useLiveData(contextValue.selectedDocIds$);

  const selected = selectedDocIds.includes(doc.id);

  const onChange = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      contextValue.selectMode$?.next(true);
      onClick?.(e);
      e.stopPropagation();
      e.preventDefault();
      contextValue.selectMode$?.next(true);
      contextValue.selectedDocIds$?.next(
        selected
          ? selectedDocIds.filter(id => id !== doc.id)
          : [...selectedDocIds, doc.id]
      );
    },
    [contextValue, doc.id, onClick, selected, selectedDocIds]
  );

  if (!quickSelect) {
    return null;
  }

  return (
    <IconButton
      onClick={onChange}
      icon={<Checkbox checked={selected} style={{ pointerEvents: 'none' }} />}
      {...iconButtonProps}
    />
  );
});

export const QuickDeletePermanently = memo(function QuickDeletePermanently({
  doc,
  onClick,
  ...iconButtonProps
}: QuickActionProps) {
  const t = useI18n();
  const guardService = useService(GuardService);
  const contextValue = useContext(DocExplorerContext);
  const { permanentlyDeletePage } = useBlockSuiteMetaHelper();
  const quickDeletePermanently = useLiveData(
    contextValue.quickDeletePermanently$
  );
  const { openConfirmModal } = useConfirmModal();

  const handleDeletePermanently = useCallback(() => {
    guardService
      .can('Doc_Delete', doc.id)
      .then(can => {
        if (can) {
          permanentlyDeletePage(doc.id);
          toast(t['com.notesgraph.toastMessage.permanentlyDeleted']());
        } else {
          toast(t['com.notesgraph.no-permission']());
        }
      })
      .catch(e => {
        console.error(e);
      });
  }, [doc.id, guardService, permanentlyDeletePage, t]);

  const handleConfirmDeletePermanently = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      e.stopPropagation();
      e.preventDefault();
      openConfirmModal({
        title: `${t['com.notesgraph.trashOperation.deletePermanently']()}?`,
        description: t['com.notesgraph.trashOperation.deleteDescription'](),
        cancelText: t['Cancel'](),
        confirmText: t['com.notesgraph.trashOperation.delete'](),
        confirmButtonOptions: {
          variant: 'error',
        },
        onConfirm: handleDeletePermanently,
      });
    },
    [handleDeletePermanently, onClick, openConfirmModal, t]
  );

  if (!quickDeletePermanently) {
    return null;
  }

  return (
    <IconButton
      data-testid="delete-page-button"
      onClick={handleConfirmDeletePermanently}
      icon={<DeleteIcon />}
      variant="danger"
      {...iconButtonProps}
    />
  );
});

export const QuickRestore = memo(function QuickRestore({
  doc,
  onClick,
  ...iconButtonProps
}: QuickActionProps) {
  const t = useI18n();
  const contextValue = useContext(DocExplorerContext);
  const quickRestore = useLiveData(contextValue.quickRestore$);
  const { restoreFromTrash } = useBlockSuiteMetaHelper();
  const guardService = useService(GuardService);

  const handleRestore = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      e.stopPropagation();
      e.preventDefault();
      guardService
        .can('Doc_Delete', doc.id)
        .then(can => {
          if (can) {
            restoreFromTrash(doc.id);
            toast(
              t['com.notesgraph.toastMessage.restored']({
                title: doc.title$.value || 'Untitled',
              })
            );
          } else {
            toast(t['com.notesgraph.no-permission']());
          }
        })
        .catch(e => {
          console.error(e);
        });
    },
    [doc.id, doc.title$, guardService, onClick, restoreFromTrash, t]
  );

  if (!quickRestore) {
    return null;
  }

  return (
    <IconButton
      data-testid="restore-page-button"
      onClick={handleRestore}
      icon={<ResetIcon />}
      {...iconButtonProps}
    />
  );
});

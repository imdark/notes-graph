import {
  DeleteIcon,
  EdgelessIcon,
  InformationIcon,
  MoreHorizontalIcon,
  PageIcon,
  TocIcon,
} from '@blocksuite/icons/rc';
import {
  IconButton,
  notify,
  toast,
  useConfirmModal,
} from '@notesgraph/component';
import {
  MenuSeparator,
  MenuSub,
  MobileMenu,
  MobileMenuItem,
} from '@notesgraph/component/ui/menu';
import { useFavorite } from '@notesgraph/core/blocksuite/block-suite-header/favorite';
import { Guard, useGuard } from '@notesgraph/core/components/guard';
import { IsFavoriteIcon } from '@notesgraph/core/components/pure/icons';
import {
  DocInfoSheet,
  SetParentMenuSection,
} from '@notesgraph/core/mobile/components';
import { MobileTocMenu } from '@notesgraph/core/mobile/components/toc-menu';
import { DocService } from '@notesgraph/core/modules/doc';
import { DocModeRegistryService } from '@notesgraph/core/modules/doc-mode-registry';
import { EditorService } from '@notesgraph/core/modules/editor';
import { ViewService } from '@notesgraph/core/modules/workbench/services/view';
import { preventDefault } from '@notesgraph/core/utils';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { useCallback, useEffect, useState } from 'react';

import { JournalConflictsMenuItem } from './menu/journal-conflicts';
import { JournalTodayActivityMenuItem } from './menu/journal-today-activity';
import { EditorModeSwitch } from './menu/mode-switch';
import * as styles from './page-header-more-button.css';

export const PageHeaderMenuButton = () => {
  const t = useI18n();

  const doc = useService(DocService).doc;
  const docId = doc?.id;
  const canEdit = useGuard('Doc_Update', docId);

  const editorService = useService(EditorService);
  const editorContainer = useLiveData(editorService.editor.editorContainer$);

  const [open, setOpen] = useState(false);
  const location = useLiveData(useService(ViewService).view.location$);

  const isInTrash = useLiveData(
    editorService.editor.doc.meta$.map(meta => meta.trash)
  );
  const primaryMode = useLiveData(editorService.editor.doc.primaryMode$);
  const docModes = useLiveData(useService(DocModeRegistryService).modes$);
  const title = useLiveData(editorService.editor.doc.title$);

  const { favorite, toggleFavorite } = useFavorite(docId);
  const { openConfirmModal } = useConfirmModal();

  const handleSwitchMode = useCallback(() => {
    const mode = primaryMode === 'page' ? 'edgeless' : 'page';
    // TODO(@JimmFly): remove setMode when there has view mode switch
    editorService.editor.setMode(mode);
    editorService.editor.doc.setPrimaryMode(mode);
    track.$.header.docOptions.switchPageMode({
      mode,
    });
    notify.success({
      title:
        primaryMode === 'page'
          ? t['com.notesgraph.toastMessage.defaultMode.edgeless.title']()
          : t['com.notesgraph.toastMessage.defaultMode.page.title'](),
      message:
        primaryMode === 'page'
          ? t['com.notesgraph.toastMessage.defaultMode.edgeless.message']()
          : t['com.notesgraph.toastMessage.defaultMode.page.message'](),
    });
  }, [primaryMode, editorService, t]);

  const handleMenuOpenChange = useCallback((open: boolean) => {
    if (open) {
      track.$.header.docOptions.open();
    }
    setOpen(open);
  }, []);

  useEffect(() => {
    // when the location is changed, close the menu
    handleMenuOpenChange(false);
  }, [handleMenuOpenChange, location.pathname]);

  const handleToggleFavorite = useCallback(() => {
    track.$.header.docOptions.toggleFavorite();
    toggleFavorite();
  }, [toggleFavorite]);

  const handleMoveToTrash = useCallback(() => {
    if (!doc) {
      return;
    }
    openConfirmModal({
      title: t['com.notesgraph.moveToTrash.title'](),
      description: t['com.notesgraph.moveToTrash.confirmModal.description']({
        title: doc.title$.value,
      }),
      confirmText: t['com.notesgraph.moveToTrash.confirmModal.confirm'](),
      cancelText: t['com.notesgraph.moveToTrash.confirmModal.cancel'](),
      confirmButtonOptions: {
        variant: 'error',
      },
      onConfirm() {
        doc.moveToTrash();
        track.$.navigationPanel.docs.deleteDoc({
          control: 'button',
        });
        toast(t['com.notesgraph.toastMessage.movedTrash']());
        // navigate back
        history.back();
      },
    });
  }, [doc, openConfirmModal, t]);

  const EditMenu = (
    <>
      <EditorModeSwitch />
      <JournalTodayActivityMenuItem suffix={<MenuSeparator />} />
      {docModes.length > 1 && (
        <MobileMenuItem
          prefixIcon={primaryMode === 'page' ? <EdgelessIcon /> : <PageIcon />}
          data-testid="editor-option-menu-mode-switch"
          onSelect={handleSwitchMode}
          disabled={!canEdit}
        >
          {primaryMode === 'page'
            ? t['com.notesgraph.editorDefaultMode.edgeless']()
            : t['com.notesgraph.editorDefaultMode.page']()}
        </MobileMenuItem>
      )}
      <MobileMenuItem
        data-testid="editor-option-menu-favorite"
        onSelect={handleToggleFavorite}
        prefixIcon={<IsFavoriteIcon favorite={favorite} />}
      >
        {favorite
          ? t['com.notesgraph.favoritePageOperation.remove']()
          : t['com.notesgraph.favoritePageOperation.add']()}
      </MobileMenuItem>
      <SetParentMenuSection docId={docId} />
      <MenuSeparator />
      <MenuSub
        triggerOptions={{
          prefixIcon: <InformationIcon />,
          onClick: preventDefault,
        }}
        title={title ?? t['unnamed']()}
        items={<DocInfoSheet docId={docId} />}
      >
        <span>{t['com.notesgraph.page-properties.page-info.view']()}</span>
      </MenuSub>
      <MobileMenu
        title={t['com.notesgraph.header.menu.toc']()}
        items={
          <div className={styles.outlinePanel}>
            <MobileTocMenu editor={editorContainer?.host ?? null} />
          </div>
        }
      >
        <MobileMenuItem prefixIcon={<TocIcon />} onClick={preventDefault}>
          <span>{t['com.notesgraph.header.option.view-toc']()}</span>
        </MobileMenuItem>
      </MobileMenu>
      <JournalConflictsMenuItem />
      <Guard docId={docId} permission="Doc_Trash">
        {canMoveToTrash => (
          <MobileMenuItem
            prefixIcon={<DeleteIcon />}
            type="danger"
            disabled={!canMoveToTrash}
            onSelect={handleMoveToTrash}
          >
            {t['com.notesgraph.moveToTrash.title']()}
          </MobileMenuItem>
        )}
      </Guard>
    </>
  );
  if (isInTrash) {
    return null;
  }
  return (
    <MobileMenu
      items={EditMenu}
      contentOptions={{
        align: 'center',
      }}
      rootOptions={{
        open,
        onOpenChange: handleMenuOpenChange,
      }}
    >
      <IconButton
        size={24}
        data-testid="detail-page-header-more-button"
        className={styles.iconButton}
      >
        <MoreHorizontalIcon />
      </IconButton>
    </MobileMenu>
  );
};

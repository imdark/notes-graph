import {
  AnimatedDeleteIcon,
  toast,
  useConfirmModal,
  useDropTarget,
} from '@notesgraph/component';
import { MenuLinkItem } from '@notesgraph/core/modules/app-sidebar/views';
import { DocsService } from '@notesgraph/core/modules/doc';
import { GlobalContextService } from '@notesgraph/core/modules/global-context';
import { GuardService } from '@notesgraph/core/modules/permissions';
import type { NotesGraphDNDData } from '@notesgraph/core/types/dnd';
import { UserFriendlyError } from '@notesgraph/error';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';

export const TrashButton = () => {
  const t = useI18n();
  const docsService = useService(DocsService);
  const { openConfirmModal } = useConfirmModal();
  const globalContextService = useService(GlobalContextService);
  const trashActive = useLiveData(globalContextService.globalContext.isTrash.$);
  const guardService = useService(GuardService);

  const { dropTargetRef, draggedOver } = useDropTarget<NotesGraphDNDData>(
    () => ({
      data: {
        at: 'app-sidebar:trash',
      },
      canDrop(data) {
        return data.source.data.entity?.type === 'doc';
      },
      onDrop(data) {
        if (data.source.data.entity?.type === 'doc') {
          const docId = data.source.data.entity.id;
          const docRecord = docsService.list.doc$(docId).value;
          if (docRecord) {
            openConfirmModal({
              title: t['com.notesgraph.moveToTrash.confirmModal.title'](),
              description: t[
                'com.notesgraph.moveToTrash.confirmModal.description'
              ]({
                title: docRecord.title$.value || t['Untitled'](),
              }),
              confirmText: t.Delete(),
              confirmButtonOptions: {
                variant: 'error',
              },
              async onConfirm() {
                try {
                  const canTrash = await guardService.can(
                    'Doc_Trash',
                    docRecord.id
                  );
                  if (!canTrash) {
                    toast(t['com.notesgraph.no-permission']());
                    return;
                  }
                  docRecord.moveToTrash();
                } catch (error) {
                  console.error(error);
                  const userFriendlyError = UserFriendlyError.fromAny(error);
                  toast(
                    t[`error.${userFriendlyError.name}`](userFriendlyError.data)
                  );
                }
              },
            });
          }
        }
      },
      allowExternal: true,
    }),
    [docsService.list, guardService, openConfirmModal, t]
  );

  return (
    <MenuLinkItem
      ref={dropTargetRef}
      icon={<AnimatedDeleteIcon closed={draggedOver} />}
      active={trashActive || draggedOver}
      to={'/trash'}
    >
      <span data-testid="trash-page">
        {t['com.notesgraph.workspaceSubPath.trash']()}
      </span>
    </MenuLinkItem>
  );
};

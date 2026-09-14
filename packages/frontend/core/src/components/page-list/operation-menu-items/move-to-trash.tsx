import { DeleteIcon } from '@blocksuite/icons/rc';
import type { ConfirmModalProps, MenuItemProps } from '@notesgraph/component';
import { ConfirmModal, MenuItem } from '@notesgraph/component';
import { useI18n } from '@notesgraph/i18n';

export const MoveToTrash = (props: MenuItemProps) => {
  const t = useI18n();

  return (
    <MenuItem prefixIcon={<DeleteIcon />} type="danger" {...props}>
      {t['com.notesgraph.moveToTrash.title']()}
    </MenuItem>
  );
};

const MoveToTrashConfirm = ({
  titles,
  ...confirmModalProps
}: {
  titles: string[];
} & ConfirmModalProps) => {
  const t = useI18n();
  const multiple = titles.length > 1;
  const title = multiple
    ? t['com.notesgraph.moveToTrash.confirmModal.title.multiple']({
        number: titles.length.toString(),
      })
    : t['com.notesgraph.moveToTrash.confirmModal.title']();
  const description = multiple
    ? t['com.notesgraph.moveToTrash.confirmModal.description.multiple']({
        number: titles.length.toString(),
      })
    : t['com.notesgraph.moveToTrash.confirmModal.description']({
        title: titles[0] || t['Untitled'](),
      });
  return (
    <ConfirmModal
      title={title}
      description={description}
      cancelText={t['com.notesgraph.confirmModal.button.cancel']()}
      confirmText={t.Delete()}
      confirmButtonOptions={{
        ['data-testid' as string]: 'confirm-delete-page',
        variant: 'error',
      }}
      {...confirmModalProps}
    />
  );
};

MoveToTrash.ConfirmModal = MoveToTrashConfirm;

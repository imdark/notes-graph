import { ShareIcon } from '@blocksuite/icons/rc';
import type { MenuItemProps } from '@notesgraph/component';
import { MenuItem } from '@notesgraph/component';
import { useI18n } from '@notesgraph/i18n';

export const DisablePublicSharing = (props: MenuItemProps) => {
  const t = useI18n();
  return (
    <MenuItem type="danger" prefixIcon={<ShareIcon />} {...props}>
      {t['Disable Public Sharing']()}
    </MenuItem>
  );
};

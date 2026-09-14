import { IconButton, Menu } from '@notesgraph/component';
import { NotificationList } from '@notesgraph/core/components/notification/list';
import { AuthService } from '@notesgraph/core/modules/cloud';
import { NotificationCountService } from '@notesgraph/core/modules/notification';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { NotificationIcon } from '@blocksuite/icons/rc';
import { useCallback, useState } from 'react';

import * as styles from './index.css';

/**
 * The notification bell, in the top bar's right side (mirrors the sidebar
 * NotificationButton but styled as a header icon button with an unread
 * badge). Signed-in cloud users only — local docs have no notifications.
 */
export const HeaderNotificationButton = () => {
  const authService = useService(AuthService);
  const status = useLiveData(authService.session.status$);
  const notificationCountService = useService(NotificationCountService);
  const count = useLiveData(notificationCountService.count$);
  const t = useI18n();
  const [open, setOpen] = useState(false);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        track.$.sidebar.notifications.openInbox({
          unreadCount: notificationCountService.count$.value,
        });
      }
      setOpen(next);
    },
    [notificationCountService.count$.value]
  );

  if (status !== 'authenticated') {
    return null;
  }

  return (
    <Menu
      rootOptions={{ open, onOpenChange }}
      contentOptions={{ align: 'end', sideOffset: 8 }}
      items={<NotificationList />}
    >
      <div className={styles.wrapper}>
        <IconButton
          size={20}
          data-testid="header-notification-button"
          tooltip={t['com.notesgraph.rootAppSidebar.notifications']()}
        >
          <NotificationIcon />
        </IconButton>
        {count > 0 ? (
          <span className={styles.badge}>{count > 99 ? '99+' : count}</span>
        ) : null}
      </div>
    </Menu>
  );
};

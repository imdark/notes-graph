import { ArrowRightSmallIcon } from '@blocksuite/icons/rc';
import { Avatar } from '@notesgraph/component';
import { useSignOut } from '@notesgraph/core/components/hooks/notesgraph/use-sign-out';
import { AuthService } from '@notesgraph/core/modules/cloud';
import { GlobalDialogService } from '@notesgraph/core/modules/dialogs';
import { useLiveData, useService } from '@notesgraph/infra';
import { type ReactNode } from 'react';

import { UserPlanTag } from '../../../components';
import { SettingGroup } from '../group';
import * as styles from './style.css';

export const UserProfile = () => {
  const session = useService(AuthService).session;
  const loginStatus = useLiveData(session.status$);

  return loginStatus === 'authenticated' ? (
    <AuthorizedUserProfile />
  ) : (
    <UnauthorizedUserProfile />
  );
};

const BaseLayout = ({
  avatar,
  title,
  caption,
  onClick,
}: {
  avatar: ReactNode;
  title: ReactNode;
  caption: ReactNode;
  onClick?: () => void;
}) => {
  return (
    <SettingGroup contentStyle={{ padding: '10px 8px 10px 10px' }}>
      <div className={styles.profile} onClick={onClick}>
        <div className={styles.avatarWrapper}>{avatar}</div>
        <div className={styles.content}>
          <div className={styles.title}>{title}</div>
          <div className={styles.caption}>{caption}</div>
        </div>
        <ArrowRightSmallIcon className={styles.suffixIcon} />
      </div>
    </SettingGroup>
  );
};

const AuthorizedUserProfile = () => {
  const session = useService(AuthService).session;
  const account = useLiveData(session.account$);
  const confirmSignOut = useSignOut();

  return (
    <BaseLayout
      avatar={
        <Avatar
          size={48}
          rounded={4}
          url={account?.avatar}
          name={account?.label}
        />
      }
      caption={<span className={styles.emailInfo}>{account?.email}</span>}
      title={
        <div className={styles.nameWithTag}>
          <span className={styles.name}>{account?.label}</span>
          <UserPlanTag />
        </div>
      }
      onClick={confirmSignOut}
    />
  );
};

const UnauthorizedUserProfile = () => {
  const globalDialogService = useService(GlobalDialogService);

  return (
    <BaseLayout
      onClick={() => globalDialogService.open('sign-in', {})}
      avatar={<Avatar size={48} rounded={4} />}
      title="Sign up / Sign in"
      caption="Sync with NotesGraph Cloud"
    />
  );
};

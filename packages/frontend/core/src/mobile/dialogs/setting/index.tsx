import { AuthService } from '@notesgraph/core/modules/cloud';
import type {
  DialogComponentProps,
  WORKSPACE_DIALOG_SCHEMA,
} from '@notesgraph/core/modules/dialogs';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { useEffect } from 'react';

import { AboutGroup } from './about';
import { AppearanceGroup } from './appearance';
import { ExperimentalFeatureSetting } from './experimental';
import { OthersGroup } from './others';
import * as styles from './style.css';
import { UserSubscription } from './subscription';
import { SwipeDialog } from './swipe-dialog';
import { SyncGroup } from './sync';
import { UserProfile } from './user-profile';
import { UserUsage } from './user-usage';

const MobileSetting = () => {
  const session = useService(AuthService).session;
  useEffect(() => session.revalidate(), [session]);

  return (
    <div className={styles.root}>
      <UserProfile />
      <UserSubscription />
      <UserUsage />
      <AppearanceGroup />
      <SyncGroup />
      <AboutGroup />
      <ExperimentalFeatureSetting />
      <OthersGroup />
    </div>
  );
};

export const SettingDialog = ({
  close,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['setting']>) => {
  const t = useI18n();

  return (
    <SwipeDialog
      title={t['com.notesgraph.mobile.setting.header-title']()}
      open
      onOpenChange={() => close()}
    >
      <MobileSetting />
    </SwipeDialog>
  );

  // return (
  //   <ConfigModal
  //     title={t['com.notesgraph.mobile.setting.header-title']()}
  //     open
  //     onOpenChange={() => close()}
  //     onBack={close}
  //   >
  //     <MobileSetting />
  //   </ConfigModal>
  // );
};

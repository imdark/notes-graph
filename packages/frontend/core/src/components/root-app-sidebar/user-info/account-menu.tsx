import { AccountIcon, AdminIcon, SignOutIcon } from '@blocksuite/icons/rc';
import { MenuItem } from '@notesgraph/component';
import {
  ServerService,
  UserFeatureService,
} from '@notesgraph/core/modules/cloud';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { useCallback, useEffect } from 'react';

import { useSignOut } from '../../hooks/notesgraph/use-sign-out';

export const AccountMenu = () => {
  const workspaceDialogService = useService(WorkspaceDialogService);
  const openSignOutModal = useSignOut();
  const serverService = useService(ServerService);
  const userFeatureService = useService(UserFeatureService);
  const isNotesGraphAdmin = useLiveData(
    userFeatureService.userFeature.isAdmin$
  );

  const onOpenAccountSetting = useCallback(() => {
    track.$.navigationPanel.profileAndBadge.openSettings({ to: 'account' });
    workspaceDialogService.open('setting', {
      activeTab: 'account',
    });
  }, [workspaceDialogService]);

  const onOpenAdminPanel = useCallback(() => {
    window.open(`${serverService.server.baseUrl}/admin`, '_blank');
  }, [serverService.server.baseUrl]);

  const t = useI18n();

  useEffect(() => {
    userFeatureService.userFeature.revalidate();
  }, [userFeatureService]);

  return (
    <>
      <MenuItem
        prefixIcon={<AccountIcon />}
        data-testid="workspace-modal-account-settings-option"
        onClick={onOpenAccountSetting}
      >
        {t['com.notesgraph.workspace.cloud.account.settings']()}
      </MenuItem>
      {isNotesGraphAdmin ? (
        <MenuItem
          prefixIcon={<AdminIcon />}
          data-testid="workspace-modal-account-admin-option"
          onClick={onOpenAdminPanel}
        >
          {t['com.notesgraph.workspace.cloud.account.admin']()}
        </MenuItem>
      ) : null}
      <MenuItem
        prefixIcon={<SignOutIcon />}
        data-testid="workspace-modal-sign-out-option"
        onClick={openSignOutModal}
      >
        {t['com.notesgraph.workspace.cloud.account.logout']()}
      </MenuItem>
    </>
  );
};

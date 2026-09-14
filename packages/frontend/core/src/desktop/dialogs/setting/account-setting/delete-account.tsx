import { ArrowRightSmallIcon } from '@blocksuite/icons/rc';
import { ConfirmModal, Input, notify } from '@notesgraph/component';
import {
  SettingRow,
  SettingWrapper,
} from '@notesgraph/component/setting-components';
import { AuthService, ServerService } from '@notesgraph/core/modules/cloud';
import { WorkspacesService } from '@notesgraph/core/modules/workspace';
import { UserFriendlyError } from '@notesgraph/error';
import { Trans, useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { cssVarV2 } from '@toeverything/theme/v2';
import { useCallback, useState } from 'react';

import * as styles from './style.css';

export const DeleteAccount = () => {
  const t = useI18n();

  const serverService = useService(ServerService);
  const workspacesService = useService(WorkspacesService);
  const workspaceProfiles = workspacesService.getAllWorkspaceProfile();
  const isTeamWorkspaceOwner = workspaceProfiles.some(
    profile => profile.profile$.value?.isTeam && profile.profile$.value.isOwner
  );
  const [showModal, setShowModal] = useState(false);
  const openModal = useCallback(() => {
    setShowModal(true);
  }, []);

  return (
    <SettingWrapper>
      <SettingRow
        name={
          <span style={{ color: cssVarV2('status/error') }}>
            {t['com.notesgraph.setting.account.delete-from-server']({
              server: serverService.server.config$.value.serverName,
            })}
          </span>
        }
        desc={t['com.notesgraph.setting.account.delete.message']()}
        style={{ cursor: 'pointer' }}
        onClick={openModal}
        data-testid="delete-account-button"
      >
        <ArrowRightSmallIcon />
      </SettingRow>
      {isTeamWorkspaceOwner ? (
        <TeamOwnerWarningModal open={showModal} onOpenChange={setShowModal} />
      ) : (
        <DeleteAccountModal open={showModal} onOpenChange={setShowModal} />
      )}
    </SettingWrapper>
  );
};

const TeamOwnerWarningModal = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const t = useI18n();
  const onConfirm = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);
  return (
    <ConfirmModal
      open={open}
      onOpenChange={onOpenChange}
      title={t['com.notesgraph.setting.account.delete.team-warning-title']()}
      description={t[
        'com.notesgraph.setting.account.delete.team-warning-description'
      ]()}
      confirmText={t['Confirm']()}
      confirmButtonOptions={{
        variant: 'primary',
      }}
      onConfirm={onConfirm}
      cancelButtonOptions={{
        style: {
          display: 'none',
        },
      }}
    />
  );
};

const DeleteAccountModal = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const t = useI18n();
  const authService = useService(AuthService);
  const session = authService.session;
  const account = useLiveData(session.account$);
  const serverService = useService(ServerService);

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleDeleteAccount = useCallback(async () => {
    try {
      setIsLoading(true);
      await authService.deleteAccount();
      track.$.$.auth.deleteAccount();
    } catch (err) {
      console.error(err);
      const error = UserFriendlyError.fromAny(err);
      notify.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [authService]);

  const onDeleteAccountConfirm = useCallback(async () => {
    await handleDeleteAccount();
  }, [handleDeleteAccount]);

  if (!account) {
    return null;
  }
  return (
    <ConfirmModal
      open={open}
      cancelText={t['com.notesgraph.confirmModal.button.cancel']()}
      onConfirm={onDeleteAccountConfirm}
      onOpenChange={onOpenChange}
      title={t['com.notesgraph.setting.account.delete.confirm-title']()}
      description={
        <Trans
          i18nKey={
            'com.notesgraph.setting.account.delete.confirm-delete-description-1'
          }
          components={{
            1: <strong />,
          }}
          values={{
            server:
              serverService.server.id !== 'notesgraph-cloud'
                ? `${serverService.server.config$.value.serverName} (${serverService.server.baseUrl})`
                : serverService.server.config$.value.serverName,
          }}
        />
      }
      confirmText={t['com.notesgraph.setting.account.delete.confirm-button']()}
      confirmButtonOptions={{
        variant: 'error',
        disabled: email !== account.email,
        loading: isLoading,
      }}
      childrenContentClassName={styles.confirmContent}
    >
      <Trans
        i18nKey="com.notesgraph.setting.account.delete.confirm-delete-description-2"
        components={{
          1: <strong />,
        }}
      />
      <Input
        type="text"
        placeholder={t[
          'com.notesgraph.setting.account.delete.input-placeholder'
        ]()}
        value={email}
        onChange={setEmail}
        className={styles.inputWrapper}
      />
    </ConfirmModal>
  );
};

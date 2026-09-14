import { ArrowRightSmallIcon, CameraIcon } from '@blocksuite/icons/rc';
import { FlexWrapper, Input, notify } from '@notesgraph/component';
import {
  SettingHeader,
  SettingRow,
  SettingWrapper,
} from '@notesgraph/component/setting-components';
import { Avatar } from '@notesgraph/component/ui/avatar';
import { Button } from '@notesgraph/component/ui/button';
import { useSignOut } from '@notesgraph/core/components/hooks/notesgraph/use-sign-out';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { useCatchEventCallback } from '@notesgraph/core/components/hooks/use-catch-event-hook';
import { Upload } from '@notesgraph/core/components/pure/file-upload';
import { GlobalDialogService } from '@notesgraph/core/modules/dialogs';
import { SubscriptionPlan } from '@notesgraph/graphql';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService, useServices } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AuthService, ServerService } from '../../../../modules/cloud';
import type { SettingState } from '../types';
import { AIUsagePanel } from './ai-usage-panel';
import { DeleteAccount } from './delete-account';
import { IntegrationsPanel } from './integrations-panel';
import { StorageProgress } from './storage-progress';
import * as styles from './style.css';

const AVATAR_ACCEPT = 'image/gif,image/jpeg,image/jpg,image/png,image/svg';

export const UserAvatar = () => {
  const t = useI18n();
  const { authService, serverService, globalDialogService } = useServices({
    AuthService,
    ServerService,
    GlobalDialogService,
  });
  const session = authService.session;
  const account = useLiveData(session.account$);
  const companionUrl = useLiveData(
    useMemo(
      () => serverService.server.config$.map(config => config?.companionUrl),
      [serverService]
    )
  );

  const handleUpdateUserAvatar = useAsyncCallback(
    async (file: File) => {
      try {
        track.$.settingsPanel.accountSettings.uploadAvatar();
        await session.uploadAvatar(file);
        notify.success({ title: 'Update user avatar success' });
      } catch (e) {
        // TODO(@catsjuice): i18n
        notify.error({
          title: 'Update user avatar failed',
          message: String(e),
        });
      }
    },
    [session]
  );

  const handleRemoveUserAvatar = useCatchEventCallback(async () => {
    track.$.settingsPanel.accountSettings.removeAvatar();
    await session.removeAvatar();
  }, [session]);

  const handleUploadFromCloud = useCallback(() => {
    globalDialogService.open(
      'uppy-upload',
      {
        serverBaseUrl: serverService.server.baseUrl,
        companionUrl,
        accept: AVATAR_ACCEPT,
        multiple: false,
      },
      files => {
        const file = files?.[0];
        if (file) {
          handleUpdateUserAvatar(file);
        }
      }
    );
  }, [
    companionUrl,
    globalDialogService,
    handleUpdateUserAvatar,
    serverService.server.baseUrl,
  ]);

  return (
    <FlexWrapper alignItems="center" style={{ gap: 8 }}>
      <Upload
        accept={AVATAR_ACCEPT}
        fileChange={handleUpdateUserAvatar}
        data-testid="upload-user-avatar"
      >
        <Avatar
          size={56}
          name={account?.label}
          url={account?.avatar}
          hoverIcon={<CameraIcon />}
          onRemove={account?.avatar ? handleRemoveUserAvatar : undefined}
          avatarTooltipOptions={{ content: t['Click to replace photo']() }}
          removeTooltipOptions={{ content: t['Remove photo']() }}
          data-testid="user-setting-avatar"
          removeButtonProps={{
            ['data-testid' as string]: 'user-setting-remove-avatar-button',
          }}
        />
      </Upload>
      {companionUrl ? (
        <Button
          onClick={handleUploadFromCloud}
          data-testid="upload-user-avatar-from-cloud"
        >
          {t['Upload']()}
        </Button>
      ) : null}
    </FlexWrapper>
  );
};

export const AvatarAndName = () => {
  const t = useI18n();
  const session = useService(AuthService).session;
  const account = useLiveData(session.account$);
  const [input, setInput] = useState<string>(account?.label ?? '');

  const allowUpdate = !!input && input !== account?.label;
  const handleUpdateUserName = useAsyncCallback(async () => {
    if (account === null) {
      return;
    }
    if (!allowUpdate) {
      return;
    }

    try {
      track.$.settingsPanel.accountSettings.updateUserName();
      await session.updateLabel(input);
    } catch (e) {
      notify.error({
        title: 'Failed to update user name.',
        message: String(e),
      });
    }
  }, [account, allowUpdate, session, input]);

  return (
    <SettingRow
      name={t['com.notesgraph.settings.profile']()}
      desc={t['com.notesgraph.settings.profile.message']()}
      spreadCol={false}
    >
      <FlexWrapper style={{ margin: '12px 0 24px 0' }} alignItems="center">
        <UserAvatar />

        <div className={styles.profileInputWrapper}>
          <label>{t['com.notesgraph.settings.profile.name']()}</label>
          <FlexWrapper alignItems="center">
            <Input
              defaultValue={input}
              data-testid="user-name-input"
              placeholder={t['com.notesgraph.settings.profile.placeholder']()}
              maxLength={64}
              minLength={0}
              style={{ width: 280, height: 32 }}
              onChange={setInput}
              onEnter={handleUpdateUserName}
            />
            {allowUpdate ? (
              <Button
                data-testid="save-user-name"
                onClick={handleUpdateUserName}
                style={{
                  marginLeft: '12px',
                }}
              >
                {t['com.notesgraph.editCollection.save']()}
              </Button>
            ) : null}
          </FlexWrapper>
        </div>
      </FlexWrapper>
    </SettingRow>
  );
};

const StoragePanel = ({
  onChangeSettingState,
}: {
  onChangeSettingState?: (settingState: SettingState) => void;
}) => {
  const t = useI18n();

  const onUpgrade = useCallback(() => {
    track.$.settingsPanel.accountUsage.viewPlans({
      plan: SubscriptionPlan.Pro,
    });
    onChangeSettingState?.({
      activeTab: 'plans',
      scrollAnchor: 'cloudPricingPlan',
    });
  }, [onChangeSettingState]);

  return (
    <SettingRow
      name={t['com.notesgraph.storage.title']()}
      desc=""
      spreadCol={false}
    >
      <StorageProgress onUpgrade={onUpgrade} />
    </SettingRow>
  );
};

export const AccountSetting = ({
  onChangeSettingState,
}: {
  onChangeSettingState?: (settingState: SettingState) => void;
}) => {
  const { authService, serverService, globalDialogService } = useServices({
    AuthService,
    ServerService,
    GlobalDialogService,
  });
  const serverFeatures = useLiveData(serverService.server.features$);
  const t = useI18n();
  const session = authService.session;
  useEffect(() => {
    session.revalidate();
  }, [session]);
  const account = useLiveData(session.account$);
  const openSignOutModal = useSignOut();

  const onChangeEmail = useCallback(() => {
    if (!account) {
      return;
    }
    globalDialogService.open('verify-email', {
      server: serverService.server.baseUrl,
      changeEmail: !!account.info?.emailVerified,
    });
  }, [account, globalDialogService, serverService.server.baseUrl]);

  const onPasswordButtonClick = useCallback(() => {
    globalDialogService.open('change-password', {
      hasPassword: account?.info?.authMethods?.password.bound,
      server: serverService.server.baseUrl,
    });
  }, [
    account?.info?.authMethods?.password.bound,
    globalDialogService,
    serverService.server.baseUrl,
  ]);

  if (!account) {
    return null;
  }
  const hasPassword = account.info?.authMethods?.password.bound;

  return (
    <>
      <SettingHeader
        title={t['com.notesgraph.setting.account']()}
        subtitle={t['com.notesgraph.setting.account.message']()}
        data-testid="account-title"
      />
      <AvatarAndName />
      <SettingWrapper>
        <SettingRow
          name={t['com.notesgraph.settings.email']()}
          desc={account.email}
        >
          <Button onClick={onChangeEmail}>
            {account.info?.emailVerified
              ? t['com.notesgraph.settings.email.action.change']()
              : t['com.notesgraph.settings.email.action.verify']()}
          </Button>
        </SettingRow>
        <SettingRow
          name={t['com.notesgraph.settings.password']()}
          desc={t['com.notesgraph.settings.password.message']()}
        >
          <Button onClick={onPasswordButtonClick}>
            {hasPassword
              ? t['com.notesgraph.settings.password.action.change']()
              : t['com.notesgraph.settings.password.action.set']()}
          </Button>
        </SettingRow>
        <StoragePanel onChangeSettingState={onChangeSettingState} />
        {serverFeatures?.copilot && (
          <AIUsagePanel onChangeSettingState={onChangeSettingState} />
        )}
        <IntegrationsPanel onChangeSettingState={onChangeSettingState} />
        <SettingRow
          name={t[`Sign out`]()}
          desc={t['com.notesgraph.setting.sign.out.message']()}
          style={{ cursor: 'pointer' }}
          data-testid="sign-out-button"
          onClick={openSignOutModal}
        >
          <ArrowRightSmallIcon />
        </SettingRow>
      </SettingWrapper>
      <DeleteAccount />
    </>
  );
};

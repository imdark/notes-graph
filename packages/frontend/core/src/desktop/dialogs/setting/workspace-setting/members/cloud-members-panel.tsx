import { ExportIcon } from '@blocksuite/icons/rc';
import {
  Button,
  Loading,
  notify,
  useConfirmModal,
} from '@notesgraph/component';
import {
  InviteTeamMemberModal,
  type InviteTeamMemberModalProps,
  MemberLimitModal,
} from '@notesgraph/component/member-components';
import { SettingRow } from '@notesgraph/component/setting-components';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { Upload } from '@notesgraph/core/components/pure/file-upload';
import {
  ServerService,
  SubscriptionService,
  WorkspaceSubscriptionService,
} from '@notesgraph/core/modules/cloud';
import {
  WorkspaceMembersService,
  WorkspacePermissionService,
} from '@notesgraph/core/modules/permissions';
import { WorkspaceQuotaService } from '@notesgraph/core/modules/quota';
import { WorkspaceShareSettingService } from '@notesgraph/core/modules/share-setting';
import { copyTextToClipboard } from '@notesgraph/core/utils/clipboard';
import { emailRegex } from '@notesgraph/core/utils/email-regex';
import { UserFriendlyError } from '@notesgraph/error';
import type { WorkspaceInviteLinkExpireTime } from '@notesgraph/graphql';
import { ServerDeploymentType, SubscriptionPlan } from '@notesgraph/graphql';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SettingState } from '../../types';
import { MemberList } from './member-list';
import * as styles from './styles.css';

const parseCSV = async (blob: Blob): Promise<string[]> => {
  try {
    const textContent = await blob.text();
    const emails = textContent
      .split('\n')
      .map(email => email.trim())
      .filter(email => email.length > 0 && emailRegex.test(email));

    return emails;
  } catch (error) {
    console.error('Error parsing CSV:', error);
    throw new Error('Failed to parse CSV');
  }
};

export const CloudWorkspaceMembersPanel = ({
  onChangeSettingState,
  isTeam,
}: {
  onChangeSettingState: (settingState: SettingState) => void;
  isTeam?: boolean;
}) => {
  const workspaceShareSettingService = useService(WorkspaceShareSettingService);
  const subscription = useService(WorkspaceSubscriptionService).subscription;
  const workspaceSubscription = useLiveData(subscription.subscription$);
  const inviteLink = useLiveData(
    workspaceShareSettingService.sharePreview.inviteLink$
  );
  const serverService = useService(ServerService);
  const hasPaymentFeature = useLiveData(
    serverService.server.features$.map(f => f?.payment)
  );
  const isSelfhosted = useLiveData(
    serverService.server.config$.selector(
      c => c.type === ServerDeploymentType.Selfhosted
    )
  );
  const membersService = useService(WorkspaceMembersService);
  const permissionService = useService(WorkspacePermissionService);

  const isOwner = useLiveData(permissionService.permission.isOwner$);
  const isAdmin = useLiveData(permissionService.permission.isAdmin$);
  const isOwnerOrAdmin = isOwner || isAdmin;
  useEffect(() => {
    permissionService.permission.revalidate();
  }, [permissionService]);

  useEffect(() => {
    membersService.members.revalidate();
  }, [membersService]);

  useEffect(() => {
    if (isOwnerOrAdmin) {
      workspaceShareSettingService.sharePreview.revalidateInviteLink();
    }
  }, [isOwnerOrAdmin, workspaceShareSettingService.sharePreview]);

  const workspaceQuotaService = useService(WorkspaceQuotaService);
  useEffect(() => {
    workspaceQuotaService.quota.revalidate();
  }, [workspaceQuotaService]);
  const isLoading = useLiveData(workspaceQuotaService.quota.isRevalidating$);
  const error = useLiveData(workspaceQuotaService.quota.error$);
  const workspaceQuota = useLiveData(workspaceQuotaService.quota.quota$);
  const subscriptionService = useService(SubscriptionService);
  const plan = useLiveData(
    subscriptionService.subscription.pro$.map(s => s?.plan)
  );

  const t = useI18n();

  const [openInvite, setOpenInvite] = useState(false);
  const [openMemberLimit, setOpenMemberLimit] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  const { openConfirmModal, closeConfirmModal } = useConfirmModal();
  const goToTeamBilling = useCallback(() => {
    onChangeSettingState({
      activeTab: isSelfhosted ? 'workspace:license' : 'workspace:billing',
    });
  }, [isSelfhosted, onChangeSettingState]);
  const [idempotencyKey, setIdempotencyKey] = useState(nanoid());
  const resume = useAsyncCallback(async () => {
    try {
      setIsMutating(true);
      await subscription.resumeSubscription(
        idempotencyKey,
        SubscriptionPlan.Team
      );
      await subscription.waitForRevalidation();
      // refresh idempotency key
      setIdempotencyKey(nanoid());
      closeConfirmModal();
      notify.success({
        title: t['com.notesgraph.payment.resume.success.title'](),
        message: t['com.notesgraph.payment.resume.success.team.message'](),
      });
    } catch (err) {
      const error = UserFriendlyError.fromAny(err);
      notify.error({
        title: error.name,
        message: error.message,
      });
    } finally {
      setIsMutating(false);
    }
  }, [subscription, idempotencyKey, closeConfirmModal, t]);
  const openInviteModal = useCallback(() => {
    if (isTeam && workspaceSubscription?.canceledAt) {
      openConfirmModal({
        title: t['com.notesgraph.payment.member.team.retry-payment.title'](),
        description:
          t[
            `com.notesgraph.payment.member.team.disabled-subscription.${isOwner ? 'owner' : 'admin'}.description`
          ](),
        confirmText:
          t[
            isOwner
              ? 'com.notesgraph.payment.member.team.disabled-subscription.resume-subscription'
              : 'Got it'
          ](),
        cancelText: t['Cancel'](),
        cancelButtonOptions: {
          style: {
            visibility: isOwner ? 'visible' : 'hidden',
          },
        },
        onConfirm: isOwner ? resume : undefined,
        confirmButtonOptions: {
          variant: 'primary',
          loading: isMutating,
        },
      });

      return;
    }
    setOpenInvite(true);
  }, [
    isMutating,
    isOwner,
    isTeam,
    openConfirmModal,
    resume,
    t,
    workspaceSubscription?.canceledAt,
  ]);

  const onGenerateInviteLink = useCallback(
    async (expireTime: WorkspaceInviteLinkExpireTime) => {
      const { link } = await membersService.generateInviteLink(expireTime);
      workspaceShareSettingService.sharePreview.revalidateInviteLink();
      return link;
    },
    [membersService, workspaceShareSettingService.sharePreview]
  );

  const onRevokeInviteLink = useCallback(async () => {
    const success = await membersService.revokeInviteLink();
    workspaceShareSettingService.sharePreview.revalidateInviteLink();
    return success;
  }, [membersService, workspaceShareSettingService.sharePreview]);

  const onInviteBatchConfirm = useAsyncCallback(
    async ({
      emails,
    }: Parameters<InviteTeamMemberModalProps['onConfirm']>[0]) => {
      setIsMutating(true);
      const uniqueEmails = deduplicateEmails(emails);
      if (
        !isTeam &&
        workspaceQuota &&
        uniqueEmails.length >
          workspaceQuota.memberLimit - workspaceQuota.memberCount
      ) {
        setOpenMemberLimit(true);
        setIsMutating(false);
        return;
      }
      const results = await membersService.inviteMembers(uniqueEmails);
      if (results) {
        notify({
          title: t['com.notesgraph.payment.member.team.invite.notify.title']({
            count: results.length.toString(),
          }),
          message: t['Invitation sent hint'](),
        });
        setOpenInvite(false);
        membersService.members.revalidate();
        workspaceQuotaService.quota.revalidate();
      }
      setIsMutating(false);
    },
    [isTeam, membersService, t, workspaceQuota, workspaceQuotaService.quota]
  );

  const onImportCSV = useAsyncCallback(
    async (file: File) => {
      setIsMutating(true);
      const emails = await parseCSV(file);
      onInviteBatchConfirm({ emails });
      setIsMutating(false);
    },
    [onInviteBatchConfirm]
  );

  const handleUpgradeConfirm = useCallback(() => {
    onChangeSettingState({
      activeTab: 'plans',
      scrollAnchor: 'cloudPricingPlan',
    });
    track.$.settingsPanel.workspace.viewPlans({
      control: 'inviteMember',
    });
  }, [onChangeSettingState]);

  const desc = useMemo(() => {
    if (!workspaceQuota) return null;

    if (isTeam) {
      return (
        <span>{t['com.notesgraph.payment.member.team.description']()}</span>
      );
    }
    return (
      <span>
        {t['com.notesgraph.payment.member.description2']()}
        {hasPaymentFeature && isOwner ? (
          <div
            className={styles.goUpgradeWrapper}
            onClick={handleUpgradeConfirm}
          >
            <span className={styles.goUpgrade}>
              {t['com.notesgraph.payment.member.description.choose-plan']()}
            </span>
          </div>
        ) : null}
      </span>
    );
  }, [
    handleUpgradeConfirm,
    hasPaymentFeature,
    isOwner,
    isTeam,
    t,
    workspaceQuota,
  ]);

  const title = useMemo(() => {
    if (isTeam) {
      return `${t['Members']()} (${workspaceQuota?.memberCount})`;
    }
    return `${t['Members']()} (${workspaceQuota?.memberCount}/${workspaceQuota?.memberLimit})`;
  }, [isTeam, t, workspaceQuota?.memberCount, workspaceQuota?.memberLimit]);

  if (workspaceQuota === null) {
    if (isLoading) {
      return <MembersPanelFallback />;
    } else {
      return (
        <span className={styles.errorStyle}>
          {error
            ? UserFriendlyError.fromAny(error).message
            : 'Failed to load members'}
        </span>
      );
    }
  }

  return (
    <>
      <SettingRow name={title} desc={desc} spreadCol={!!isOwnerOrAdmin}>
        {isOwnerOrAdmin ? (
          <>
            <Button onClick={openInviteModal}>{t['Invite Members']()}</Button>
            {!isTeam ? (
              <MemberLimitModal
                isFreePlan={!plan}
                open={openMemberLimit}
                plan={workspaceQuota.humanReadable.name ?? ''}
                quota={workspaceQuota.humanReadable.memberLimit ?? ''}
                setOpen={setOpenMemberLimit}
                onConfirm={handleUpgradeConfirm}
              />
            ) : null}
            <InviteTeamMemberModal
              open={openInvite}
              setOpen={setOpenInvite}
              onConfirm={onInviteBatchConfirm}
              isMutating={isMutating}
              copyTextToClipboard={copyTextToClipboard}
              onGenerateInviteLink={onGenerateInviteLink}
              onRevokeInviteLink={onRevokeInviteLink}
              importCSV={<ImportCSV onImport={onImportCSV} />}
              invitationLink={inviteLink}
            />
          </>
        ) : null}
      </SettingRow>

      <div className={styles.membersPanel}>
        <MemberList
          isOwner={!!isOwner}
          isAdmin={!!isAdmin}
          goToTeamBilling={goToTeamBilling}
        />
      </div>
    </>
  );
};

export const MembersPanelFallback = () => {
  const t = useI18n();

  return (
    <>
      <SettingRow
        name={t['Members']()}
        desc={t['com.notesgraph.payment.member.description2']()}
      />
      <div className={styles.membersPanel}>
        <MemberListFallback memberCount={1} />
      </div>
    </>
  );
};

const MemberListFallback = ({ memberCount }: { memberCount?: number }) => {
  // prevent page jitter
  const height = useMemo(() => {
    if (memberCount) {
      // height and margin-bottom
      return memberCount * 58 + (memberCount - 1) * 6;
    }
    return 'auto';
  }, [memberCount]);
  const t = useI18n();

  return (
    <div
      style={{
        height,
      }}
      className={styles.membersFallback}
    >
      <Loading size={20} />
      <span>{t['com.notesgraph.settings.member.loading']()}</span>
    </div>
  );
};

const ImportCSV = ({ onImport }: { onImport: (file: File) => void }) => {
  const t = useI18n();

  return (
    <Upload accept="text/csv" fileChange={onImport}>
      <Button
        className={styles.importButton}
        prefix={<ExportIcon />}
        variant="secondary"
      >
        {t['com.notesgraph.payment.member.team.invite.import-csv']()}
      </Button>
    </Upload>
  );
};

function deduplicateEmails(emails: string[]): string[] {
  const seenEmails = new Set<string>();
  return emails.filter(email => {
    const lowerCaseEmail = email.trim().toLowerCase();
    if (seenEmails.has(lowerCaseEmail)) {
      return false;
    } else {
      seenEmails.add(lowerCaseEmail);
      return true;
    }
  });
}

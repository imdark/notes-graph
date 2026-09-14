import { ArrowRightSmallIcon } from '@blocksuite/icons/rc';
import { notify } from '@notesgraph/component';
import {
  SettingHeader,
  SettingRow,
  SettingWrapper,
} from '@notesgraph/component/setting-components';
import { useWorkspaceInfo } from '@notesgraph/core/components/hooks/use-workspace-info';
import { LocalAiSetting } from '@notesgraph/core/modules/ai-local';
import { WorkspaceServerService } from '@notesgraph/core/modules/cloud';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { UNTITLED_WORKSPACE_NAME } from '@notesgraph/env/constant';
import { useI18n } from '@notesgraph/i18n';
import { FrameworkScope, useService } from '@notesgraph/infra';
import { useCallback } from 'react';

import { DeleteLeaveWorkspace } from './delete-leave-workspace';
import { EnableCloudPanel } from './enable-cloud';
import { LabelsPanel } from './labels';
import { ProfilePanel } from './profile';
import { SharingPanel } from './sharing';
import { TemplateDocSetting } from './template';
import type { WorkspaceSettingDetailProps } from './types';

export const WorkspaceSettingDetail = ({
  onCloseSetting,
}: WorkspaceSettingDetailProps) => {
  const t = useI18n();

  const workspace = useService(WorkspaceService).workspace;
  const server = workspace?.scope.get(WorkspaceServerService).server;

  const workspaceInfo = useWorkspaceInfo(workspace);

  const handleResetSyncStatus = useCallback(() => {
    workspace?.engine.doc
      .resetSync()
      .then(() => {
        onCloseSetting();
      })
      .catch(err => {
        console.error(err);
      });
  }, [onCloseSetting, workspace]);

  const handleReindex = useCallback(() => {
    workspace?.engine.indexer
      .reindex()
      .then(() => {
        notify.success({
          title: t['com.notesgraph.settings.workspace.reindex.success'](),
        });
      })
      .catch(err => {
        console.error(err);
      });
  }, [t, workspace]);

  return (
    <FrameworkScope scope={server?.scope}>
      <SettingHeader
        title={t[`Workspace Settings with name`]({
          name: workspaceInfo?.name ?? UNTITLED_WORKSPACE_NAME,
        })}
        subtitle={t['com.notesgraph.settings.workspace.description']()}
      />
      <SettingWrapper title={t['Info']()}>
        <SettingRow
          name={t['Workspace Profile']()}
          desc={t['com.notesgraph.settings.workspace.not-owner']()}
          spreadCol={false}
        >
          <ProfilePanel />
          <LabelsPanel />
          {workspace.flavour === 'local' && (
            <EnableCloudPanel onCloseSetting={onCloseSetting} />
          )}
        </SettingRow>
      </SettingWrapper>
      <TemplateDocSetting />
      <LocalAiSetting />
      <SharingPanel />
      <SettingWrapper>
        <DeleteLeaveWorkspace onCloseSetting={onCloseSetting} />
        <SettingRow
          name={
            <span style={{ color: 'var(--notesgraph-text-secondary-color)' }}>
              {t['com.notesgraph.resetSyncStatus.button']()}
            </span>
          }
          desc={t['com.notesgraph.resetSyncStatus.description']()}
          style={{ cursor: 'pointer' }}
          onClick={handleResetSyncStatus}
          data-testid="reset-sync-status"
        >
          <ArrowRightSmallIcon />
        </SettingRow>
        <SettingRow
          name={t['com.notesgraph.settings.workspace.reindex.button']()}
          desc={t['com.notesgraph.settings.workspace.reindex.description']()}
          style={{ cursor: 'pointer' }}
          onClick={handleReindex}
          data-testid="reindex-search"
        >
          <ArrowRightSmallIcon />
        </SettingRow>
      </SettingWrapper>
    </FrameworkScope>
  );
};

import {
  AiEmbeddingIcon,
  CollaborationIcon,
  FolderIcon,
  IntegrationsIcon,
  PaymentIcon,
  PropertyIcon,
  SaveIcon,
  SettingsIcon,
  ToolIcon,
} from '@blocksuite/icons/rc';
import { useWorkspaceInfo } from '@notesgraph/core/components/hooks/use-workspace-info';
import { ServerService } from '@notesgraph/core/modules/cloud';
import type { SettingTab } from '@notesgraph/core/modules/dialogs/constant';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { EmbeddingSettings } from '@notesgraph/core/modules/workspace-indexer-embedding';
import { ServerDeploymentType } from '@notesgraph/graphql';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService } from '@notesgraph/infra';
import { useMemo } from 'react';

import type { SettingSidebarItem, SettingState } from '../types';
import { WorkspaceSettingAgents } from './agents';
import { WorkspaceSettingBilling } from './billing';
import { WorkspaceSettingFolderSync } from './folder-sync';
import { IntegrationSetting } from './integration';
import { WorkspaceSettingLicense } from './license';
import { MembersPanel } from './members';
import { WorkspaceSettingDetail } from './preference';
import { WorkspaceSettingProperties } from './properties';
import { WorkspaceSettingStorage } from './storage';

export const WorkspaceSetting = ({
  activeTab,
  scrollAnchor,
  onCloseSetting,
  onChangeSettingState,
}: {
  activeTab: SettingTab;
  scrollAnchor?: string;
  onCloseSetting: () => void;
  onChangeSettingState: (settingState: SettingState) => void;
}) => {
  switch (activeTab) {
    case 'workspace:preference':
      return <WorkspaceSettingDetail onCloseSetting={onCloseSetting} />;
    case 'workspace:properties':
      return <WorkspaceSettingProperties />;
    case 'workspace:members':
      return (
        <MembersPanel
          onCloseSetting={onCloseSetting}
          onChangeSettingState={onChangeSettingState}
        />
      );
    case 'workspace:billing':
      return <WorkspaceSettingBilling />;
    case 'workspace:storage':
      return <WorkspaceSettingStorage onCloseSetting={onCloseSetting} />;
    case 'workspace:license':
      return <WorkspaceSettingLicense onCloseSetting={onCloseSetting} />;
    case 'workspace:integrations':
      return <IntegrationSetting scrollAnchor={scrollAnchor} />;
    case 'workspace:embedding':
      return <EmbeddingSettings />;
    case 'workspace:agents':
      return <WorkspaceSettingAgents />;
    case 'workspace:folder-sync':
      return <WorkspaceSettingFolderSync />;
    default:
      return null;
  }
};

export const useWorkspaceSettingList = (): SettingSidebarItem[] => {
  const workspaceService = useService(WorkspaceService);
  const information = useWorkspaceInfo(workspaceService.workspace);
  const serverService = useService(ServerService);

  const isSelfhosted = useLiveData(
    serverService.server.config$.selector(
      c => c.type === ServerDeploymentType.Selfhosted
    )
  );

  const t = useI18n();

  const showBilling =
    !isSelfhosted && information?.isTeam && information?.isOwner;
  const showLicense = information?.isOwner && isSelfhosted;
  const items = useMemo<SettingSidebarItem[]>(() => {
    return [
      {
        key: 'workspace:preference',
        title: t['com.notesgraph.settings.workspace.preferences'](),
        icon: <SettingsIcon />,
        testId: 'workspace-setting:preference',
      },
      {
        key: 'workspace:properties',
        title: t['com.notesgraph.settings.workspace.properties'](),
        icon: <PropertyIcon />,
        testId: 'workspace-setting:properties',
      },
      {
        key: 'workspace:members',
        title: t['Members'](),
        icon: <CollaborationIcon />,
        testId: 'workspace-setting:members',
      },
      {
        key: 'workspace:integrations',
        title: t['com.notesgraph.integration.integrations'](),
        icon: <IntegrationsIcon />,
        testId: 'workspace-setting:integrations',
      },
      {
        key: 'workspace:agents',
        title: 'Agents',
        icon: <ToolIcon />,
        testId: 'workspace-setting:agents',
      },
      {
        key: 'workspace:folder-sync',
        title: 'Folder sync',
        icon: <FolderIcon />,
        testId: 'workspace-setting:folder-sync',
      },
      {
        key: 'workspace:storage',
        title: t['Storage'](),
        icon: <SaveIcon />,
        testId: 'workspace-setting:storage',
      },
      {
        key: 'workspace:embedding',
        title:
          t[
            'com.notesgraph.settings.workspace.indexer-embedding.embedding.title'
          ](),
        icon: <AiEmbeddingIcon />,
        testId: 'workspace-setting:embedding',
      },
      showBilling && {
        key: 'workspace:billing' as SettingTab,
        title: t['com.notesgraph.settings.workspace.billing'](),
        icon: <PaymentIcon />,
        testId: 'workspace-setting:billing',
      },
      showLicense && {
        key: 'workspace:license' as SettingTab,
        title: t['com.notesgraph.settings.workspace.license'](),
        icon: <PaymentIcon />,
        testId: 'workspace-setting:license',
      },
    ].filter((item): item is SettingSidebarItem => !!item);
  }, [showBilling, showLicense, t]);

  return items;
};

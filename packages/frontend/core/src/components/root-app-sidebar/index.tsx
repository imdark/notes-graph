// Import is already correct, no changes needed
import {
  AiOutlineIcon,
  AllDocsIcon,
  ComputerPanelIcon,
  DuplicateIcon,
  ExportIcon,
  ImportIcon,
  JournalIcon,
  PlanetPanelIcon,
  PublishIcon,
  SettingsIcon,
  ToolIcon,
} from '@blocksuite/icons/rc';
import type { Store } from '@blocksuite/notesgraph/store';
import { ZipTransformer } from '@blocksuite/notesgraph/widgets/linked-doc';
import { notify } from '@notesgraph/component';
import { NotesGraphLogoIcon } from '@notesgraph/component/brand';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import {
  AgentExecutorService,
  AgentRunsStore,
} from '@notesgraph/core/modules/agents';
import { AppSidebarService } from '@notesgraph/core/modules/app-sidebar';
import {
  AddPageButton,
  AppDownloadButton,
  AppSidebar,
  MenuItem,
  MenuLinkItem,
  SidebarContainer,
  SidebarScrollableContainer,
} from '@notesgraph/core/modules/app-sidebar/views';
import { ExternalMenuLinkItem } from '@notesgraph/core/modules/app-sidebar/views/menu-item/external-menu-link-item';
import { ServerService } from '@notesgraph/core/modules/cloud';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import {
  getNotesGraphWorkspaceSchema,
  type Workspace,
  WorkspaceService,
} from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { useLiveData, useService, useServices } from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import { cssVarV2 } from '@toeverything/theme/v2';
import type { ReactElement } from 'react';
import { memo, useCallback, useEffect, useMemo } from 'react';

import {
  CollapsibleSection,
  NavigationPanelCollections,
  NavigationPanelFavorites,
  NavigationPanelMigrationFavorites,
  NavigationPanelNotes,
  NavigationPanelProjects,
  NavigationPanelTags,
  NavigationPanelVirtualViews,
} from '../../desktop/components/navigation-panel';
import { useDuplicateGroups } from '../../desktop/pages/workspace/duplicates/use-duplicate-groups';
import { WorkbenchService } from '../../modules/workbench';
import { WorkspaceNavigator } from '../workspace-selector';
import {
  bottomContainer,
  quickSearchAndNewPage,
  workspaceAndUserWrapper,
  workspaceWrapper,
} from './index.css';
import { InviteMembersButton } from './invite-members-button';
import { AppSidebarJournalButton } from './journal-button';
import { NetworkStatus } from './network-status';
import { SidebarAudioPlayer } from './sidebar-audio-player';
import { TemplateDocEntrance } from './template-doc-entrance';
import { TrashButton } from './trash-button';
import { UpdaterButton } from './updater-button';
import UserInfo from './user-info';

export type RootAppSidebarProps = {
  isPublicWorkspace: boolean;
  onOpenSettingModal: () => void;
  currentWorkspace: Workspace;
  openPage: (pageId: string) => void;
  createPage: () => Store;
  paths: {
    all: (workspaceId: string) => string;
    trash: (workspaceId: string) => string;
    shared: (workspaceId: string) => string;
  };
};

const AllDocsButton = () => {
  const t = useI18n();
  const { workbenchService } = useServices({
    WorkbenchService,
  });
  const workbench = workbenchService.workbench;
  const allPageActive = useLiveData(
    workbench.location$.selector(location => location.pathname === '/all')
  );

  return (
    <MenuLinkItem icon={<AllDocsIcon />} active={allPageActive} to={'/all'}>
      <span data-testid="all-pages">
        {t['com.notesgraph.workspaceSubPath.all']()}
      </span>
    </MenuLinkItem>
  );
};

const GraphButton = () => {
  const t = useI18n();
  const { workbenchService } = useServices({
    WorkbenchService,
  });
  const workbench = workbenchService.workbench;
  const graphActive = useLiveData(
    workbench.location$.selector(location => location.pathname === '/graph')
  );

  return (
    <MenuLinkItem
      icon={<NotesGraphLogoIcon />}
      active={graphActive}
      to={'/graph'}
    >
      <span data-testid="graph">
        {t['com.notesgraph.workspaceSubPath.graph']()}
      </span>
    </MenuLinkItem>
  );
};

const DiscoverButton = () => {
  const t = useI18n();
  const { workbenchService } = useServices({
    WorkbenchService,
  });
  const workbench = workbenchService.workbench;
  const discoverActive = useLiveData(
    workbench.location$.selector(location => location.pathname === '/discover')
  );

  return (
    <MenuLinkItem
      icon={<PlanetPanelIcon />}
      active={discoverActive}
      to={'/discover'}
    >
      <span data-testid="discover">{t['com.notesgraph.discover.title']()}</span>
    </MenuLinkItem>
  );
};

const DuplicatesButton = () => {
  const t = useI18n();
  const { workbenchService } = useServices({
    WorkbenchService,
  });
  const workbench = workbenchService.workbench;
  const duplicatesActive = useLiveData(
    workbench.location$.selector(
      location => location.pathname === '/duplicates'
    )
  );
  const count = useDuplicateGroups().length;

  // A background job: only surface the entry when there's something to dedup.
  if (count === 0) return null;

  return (
    <MenuLinkItem
      icon={<DuplicateIcon />}
      active={duplicatesActive}
      to={'/duplicates'}
    >
      <span
        data-testid="duplicates"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
        }}
      >
        {t['com.notesgraph.duplicates.title']()}
        <span
          style={{
            marginLeft: 'auto',
            minWidth: 18,
            height: 18,
            padding: '0 6px',
            borderRadius: 999,
            fontSize: 11,
            lineHeight: '18px',
            textAlign: 'center',
            background: cssVarV2('button/primary'),
            color: cssVarV2('button/pureWhiteText'),
          }}
        >
          {count}
        </span>
      </span>
    </MenuLinkItem>
  );
};

/** How often to check runs that say running against how they really ended. */
const RECONCILE_RUNS_MS = 30_000;

const AgentsButton = () => {
  const { workbenchService } = useServices({
    WorkbenchService,
  });
  const workbench = workbenchService.workbench;
  const agentsActive = useLiveData(
    workbench.location$.selector(location => location.pathname === '/agents')
  );
  const runsStore = useService(AgentRunsStore);
  const running = useLiveData(
    useMemo(
      () =>
        runsStore
          .watchRuns()
          .map(runs => runs.filter(run => run.status === 'running').length),
      [runsStore]
    )
  );

  // A run whose tab closed mid-way would say running forever; while any do,
  // check now and then whether they have in fact ended.
  const executor = useService(AgentExecutorService);
  useEffect(() => {
    if (running === 0) return;
    const reconcile = () => {
      executor.reconcileRuns().catch(() => {
        // Best effort: the next pass tries again.
      });
    };
    reconcile();
    const id = setInterval(reconcile, RECONCILE_RUNS_MS);
    return () => clearInterval(id);
  }, [executor, running]);

  return (
    <MenuLinkItem icon={<ToolIcon />} active={agentsActive} to={'/agents'}>
      <span
        data-testid="agents"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
        }}
      >
        Agents
        {running > 0 ? (
          <span
            title={`${running} running`}
            style={{
              marginLeft: 'auto',
              minWidth: 18,
              height: 18,
              padding: '0 6px',
              borderRadius: 999,
              fontSize: 11,
              lineHeight: '18px',
              textAlign: 'center',
              background: cssVarV2('button/primary'),
              color: cssVarV2('button/pureWhiteText'),
            }}
          >
            {running}
          </span>
        ) : null}
      </span>
    </MenuLinkItem>
  );
};

/** Features ready to merge and deploy; see DeploymentsView. */
const DeploymentsButton = () => {
  const workbench = useService(WorkbenchService).workbench;
  const active = useLiveData(
    workbench.location$.selector(
      location => location.pathname === '/deployments'
    )
  );
  return (
    <MenuLinkItem icon={<PublishIcon />} active={active} to={'/deployments'}>
      <span data-testid="deployments">Deployments</span>
    </MenuLinkItem>
  );
};

/** Inventory machines' health and monitors; see MonitoringView. */
const MonitoringButton = () => {
  const workbench = useService(WorkbenchService).workbench;
  const active = useLiveData(
    workbench.location$.selector(
      location => location.pathname === '/monitoring'
    )
  );
  return (
    <MenuLinkItem
      icon={<ComputerPanelIcon />}
      active={active}
      to={'/monitoring'}
    >
      <span data-testid="monitoring">Monitoring</span>
    </MenuLinkItem>
  );
};

const AIChatButton = () => {
  const t = useI18n();
  const featureFlagService = useService(FeatureFlagService);
  const serverService = useService(ServerService);
  const serverFeatures = useLiveData(serverService.server.features$);
  const enableAI = useLiveData(featureFlagService.flags.enable_ai.$);

  const { workbenchService } = useServices({
    WorkbenchService,
  });
  const workbench = workbenchService.workbench;
  const aiChatActive = useLiveData(
    workbench.location$.selector(location => location.pathname === '/chat')
  );

  if (!enableAI || !serverFeatures?.copilot) {
    return null;
  }

  return (
    <MenuLinkItem icon={<AiOutlineIcon />} active={aiChatActive} to={'/chat'}>
      <span data-testid="ai-chat">
        {t['com.notesgraph.workspaceSubPath.chat']()}
      </span>
    </MenuLinkItem>
  );
};

/**
 * This is for the whole notesgraph app sidebar.
 * This component wraps the app sidebar in `@notesgraph/component` with logic and data.
 *
 */
export const RootAppSidebar = memo((): ReactElement => {
  const { workbenchService } = useServices({
    WorkbenchService,
  });

  const t = useI18n();
  const appSidebar = useService(AppSidebarService).sidebar;
  const showFavorites = useLiveData(appSidebar.showFavorites$);
  const showTags = useLiveData(appSidebar.showTags$);
  const showCollections = useLiveData(appSidebar.showCollections$);
  const showNotes = useLiveData(appSidebar.showNotes$);
  const showProjects = useLiveData(appSidebar.showProjects$);
  const workspaceDialogService = useService(WorkspaceDialogService);
  const workspace = useService(WorkspaceService).workspace;
  const workbench = workbenchService.workbench;
  const workspaceSelectorOpen = useLiveData(workbench.workspaceSelectorOpen$);

  const onWorkspaceSelectorOpenChange = useCallback(
    (open: boolean) => {
      workbench.setWorkspaceSelectorOpen(open);
    },
    [workbench]
  );

  const onOpenSettingModal = useCallback(() => {
    workspaceDialogService.open('setting', {
      activeTab: 'appearance',
    });
    track.$.navigationPanel.$.openSettings();
  }, [workspaceDialogService]);

  const handleOpenDocs = useCallback(
    (result: {
      docIds: string[];
      entryId?: string;
      isWorkspaceFile?: boolean;
    }) => {
      const { docIds, entryId, isWorkspaceFile } = result;
      // If the imported file is a workspace file, open the entry page.
      if (isWorkspaceFile && entryId) {
        workbench.openDoc(entryId);
      } else if (!docIds.length) {
        return;
      }
      // Open all the docs when there are multiple docs imported.
      if (docIds.length > 1) {
        workbench.openAll();
      } else {
        // Otherwise, open the only doc.
        workbench.openDoc(docIds[0]);
      }
    },
    [workbench]
  );

  const onOpenImportModal = useCallback(() => {
    track.$.navigationPanel.importModal.open();
    workspaceDialogService.open('import', undefined, payload => {
      if (!payload) {
        return;
      }
      handleOpenDocs(payload);
    });
  }, [workspaceDialogService, handleOpenDocs]);

  const handleExportWorkspace = useAsyncCallback(async () => {
    try {
      const collection = workspace.docCollection;
      const allDocs = Array.from(collection.docs.values());
      await Promise.all(
        allDocs.map(doc => {
          doc.load();
          return workspace.engine.doc.waitForDocLoaded(doc.id);
        })
      );
      const docs = allDocs.map(doc => doc.getStore());
      await ZipTransformer.exportDocs(
        collection,
        getNotesGraphWorkspaceSchema(),
        docs
      );
      notify.success({ title: t['Export success']() });
    } catch (err) {
      notify.error({
        title: t['Export failed'](),
        message: err instanceof Error ? err.message : undefined,
      });
    }
  }, [workspace, t]);

  return (
    <AppSidebar>
      <SidebarContainer>
        <div className={workspaceAndUserWrapper}>
          <div className={workspaceWrapper}>
            <WorkspaceNavigator
              showEnableCloudButton
              showSyncStatus
              open={workspaceSelectorOpen}
              onOpenChange={onWorkspaceSelectorOpenChange}
              dense
            />
          </div>
          <UserInfo />
        </div>
        <div className={quickSearchAndNewPage}>
          {/* Quick-search removed: the notes/all-docs view has its own search
              bar on top, so the sidebar search is redundant. */}
          <AddPageButton />
        </div>
        <GraphButton />
        <DiscoverButton />
        <AppSidebarJournalButton />
        <AgentsButton />
        <DeploymentsButton />
        <MonitoringButton />
        <DuplicatesButton />
        <MenuItem
          data-testid="slider-bar-workspace-setting-button"
          icon={<SettingsIcon />}
          onClick={onOpenSettingModal}
        >
          <span data-testid="settings-modal-trigger">
            {t['com.notesgraph.settingSidebar.title']()}
          </span>
        </MenuItem>
      </SidebarContainer>
      <SidebarScrollableContainer>
        {showNotes && <NavigationPanelNotes />}
        {showFavorites && <NavigationPanelFavorites />}
        {showFavorites && <NavigationPanelMigrationFavorites />}
        {showTags && <NavigationPanelTags />}
        {showCollections && <NavigationPanelCollections />}
        {showProjects && <NavigationPanelProjects />}
        <NavigationPanelVirtualViews />
        <CollapsibleSection
          path={['others']}
          title={t['com.notesgraph.rootAppSidebar.others']()}
          contentStyle={{ padding: '6px 8px 0 8px' }}
        >
          <AllDocsButton />
          <AIChatButton />
          <TrashButton />
          <MenuItem
            data-testid="slider-bar-import-button"
            icon={<ImportIcon />}
            onClick={onOpenImportModal}
          >
            <span data-testid="import-modal-trigger">{t['Import']()}</span>
          </MenuItem>
          <MenuItem
            data-testid="slider-bar-export-workspace-button"
            icon={<ExportIcon />}
            onClick={handleExportWorkspace}
          >
            <span data-testid="export-workspace-trigger">{t['Export']()}</span>
          </MenuItem>
          <InviteMembersButton />
          <TemplateDocEntrance />
          <ExternalMenuLinkItem
            href="https://notesgraph.com/blog?tag=Release+Note"
            icon={<JournalIcon />}
            label={t['com.notesgraph.app-sidebar.learn-more']()}
          />
        </CollapsibleSection>
      </SidebarScrollableContainer>
      <SidebarContainer className={bottomContainer}>
        <SidebarAudioPlayer />
        <NetworkStatus />
        {BUILD_CONFIG.isElectron ? <UpdaterButton /> : <AppDownloadButton />}
      </SidebarContainer>
    </AppSidebar>
  );
});

RootAppSidebar.displayName = 'memo(RootAppSidebar)';

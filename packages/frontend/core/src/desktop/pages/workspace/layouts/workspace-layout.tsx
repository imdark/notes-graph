import { uniReactRoot } from '@notesgraph/component';
import { useResponsiveSidebar } from '@notesgraph/core/components/hooks/use-responsive-siedebar';
import { AiLoginRequiredModal } from '@notesgraph/core/components/notesgraph/auth/ai-login-required';
import { SWRConfigProvider } from '@notesgraph/core/components/providers/swr-config-provider';
import { WorkspaceSideEffects } from '@notesgraph/core/components/providers/workspace-side-effects';
import { AIIsland } from '@notesgraph/core/desktop/components/ai-island';
import { AppContainer } from '@notesgraph/core/desktop/components/app-container';
import { DocumentTitle } from '@notesgraph/core/desktop/components/document-title';
import { WorkspaceDialogs } from '@notesgraph/core/desktop/dialogs';
import { PeekViewManagerModal } from '@notesgraph/core/modules/peek-view';
import { QuotaCheck } from '@notesgraph/core/modules/quota';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import type { PropsWithChildren } from 'react';

export const WorkspaceLayout = function WorkspaceLayout({
  children,
}: PropsWithChildren) {
  const currentWorkspace = useService(WorkspaceService).workspace;
  return (
    <SWRConfigProvider>
      <WorkspaceDialogs />

      {/* ---- some side-effect components ---- */}
      {currentWorkspace?.flavour !== 'local' ? (
        <QuotaCheck workspaceMeta={currentWorkspace.meta} />
      ) : null}
      <AiLoginRequiredModal />
      <WorkspaceSideEffects />
      <PeekViewManagerModal />
      <DocumentTitle />

      <WorkspaceLayoutInner>{children}</WorkspaceLayoutInner>
      {/* should show after workspace loaded */}
      {/* FIXME: wait for better ai, <WorkspaceAIOnboarding /> */}
      <AIIsland />
      <uniReactRoot.Root />
    </SWRConfigProvider>
  );
};

/**
 * Wraps the workspace layout main router view
 */
const WorkspaceLayoutUIContainer = ({ children }: PropsWithChildren) => {
  const workbench = useService(WorkbenchService).workbench;
  const currentPath = useLiveData(
    LiveData.computed(get => {
      return get(workbench.basename$) + get(workbench.location$).pathname;
    })
  );
  useResponsiveSidebar();

  return (
    <AppContainer data-current-path={currentPath}>{children}</AppContainer>
  );
};
const WorkspaceLayoutInner = ({ children }: PropsWithChildren) => {
  return <WorkspaceLayoutUIContainer>{children}</WorkspaceLayoutUIContainer>;
};

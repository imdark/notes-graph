import { uniReactRoot } from '@notesgraph/component';
import { AiLoginRequiredModal } from '@notesgraph/core/components/notesgraph/auth/ai-login-required';
import { NotesGraphErrorBoundary } from '@notesgraph/core/components/notesgraph/notesgraph-error-boundary';
import { SWRConfigProvider } from '@notesgraph/core/components/providers/swr-config-provider';
import { WorkspaceSideEffects } from '@notesgraph/core/components/providers/workspace-side-effects';
import {
  DefaultServerService,
  WorkspaceServerService,
} from '@notesgraph/core/modules/cloud';
import { GlobalContextService } from '@notesgraph/core/modules/global-context';
import { PeekViewManagerModal } from '@notesgraph/core/modules/peek-view';
import type {
  Workspace,
  WorkspaceMetadata,
} from '@notesgraph/core/modules/workspace';
import { WorkspacesService } from '@notesgraph/core/modules/workspace';
import {
  FrameworkScope,
  LiveData,
  useLiveData,
  useServices,
} from '@notesgraph/infra';
import {
  type PropsWithChildren,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

import { AppFallback } from '../../components/app-fallback';
import { WorkspaceDialogs } from '../../dialogs';

// TODO(@forehalo): reuse the global context with [core/electron]
declare global {
  /**
   * @internal debug only
   */
  // oxlint-disable-next-line no-var
  var currentWorkspace: Workspace | undefined;
  // oxlint-disable-next-line no-var
  var exportWorkspaceSnapshot: (docs?: string[]) => Promise<void>;
  // oxlint-disable-next-line no-var
  var importWorkspaceSnapshot: () => Promise<void>;
  interface WindowEventMap {
    'notesgraph:workspace:change': CustomEvent<{ id: string }>;
  }
}

export const WorkspaceLayout = ({
  meta,
  children,
}: PropsWithChildren<{ meta: WorkspaceMetadata }>) => {
  // todo: reduce code duplication with packages\frontend\core\src\pages\workspace\index.tsx
  const { workspacesService, globalContextService, defaultServerService } =
    useServices({
      WorkspacesService,
      GlobalContextService,
      DefaultServerService,
    });

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const workspaceServer = workspace?.scope.get(WorkspaceServerService)?.server;

  useLayoutEffect(() => {
    const ref = workspacesService.open({ metadata: meta });
    setWorkspace(ref.workspace);
    return () => {
      ref.dispose();
    };
  }, [meta, workspacesService]);

  useEffect(() => {
    if (workspace) {
      // for debug purpose
      window.currentWorkspace = workspace ?? undefined;
      window.dispatchEvent(
        new CustomEvent('notesgraph:workspace:change', {
          detail: {
            id: workspace.id,
          },
        })
      );
      localStorage.setItem('last_workspace_id', workspace.id);
      globalContextService.globalContext.workspaceId.set(workspace.id);
      if (workspaceServer) {
        globalContextService.globalContext.serverId.set(workspaceServer.id);
      }
      globalContextService.globalContext.workspaceFlavour.set(
        workspace.flavour
      );
      return () => {
        window.currentWorkspace = undefined;
        globalContextService.globalContext.workspaceId.set(null);
        if (workspaceServer) {
          globalContextService.globalContext.serverId.set(
            defaultServerService.server.id
          );
        }
        globalContextService.globalContext.workspaceFlavour.set(null);
      };
    }
    return;
  }, [
    defaultServerService.server.id,
    globalContextService,
    workspace,
    workspaceServer,
  ]);

  const rootDocReady$ = useMemo(
    () =>
      workspace
        ? // docReady$ (not docState$): docState$'s 1s throttle would hold the
          // ready flip back and keep the skeleton up ~1s longer than needed
          LiveData.from(workspace.engine.doc.docReady$(workspace.id), false)
        : null,
    [workspace]
  );
  const isRootDocReady = useLiveData(rootDocReady$) ?? false;

  if (!workspace) {
    return null; // skip this, workspace will be set in layout effect
  }

  if (!isRootDocReady) {
    return <AppFallback />;
  }

  return (
    <FrameworkScope scope={workspaceServer?.scope}>
      <FrameworkScope scope={workspace.scope}>
        <NotesGraphErrorBoundary height="100dvh">
          <SWRConfigProvider>
            <WorkspaceDialogs />

            {/* ---- some side-effect components ---- */}
            <PeekViewManagerModal />
            <AiLoginRequiredModal />
            <uniReactRoot.Root />
            <WorkspaceSideEffects />
            {children}
          </SWRConfigProvider>
        </NotesGraphErrorBoundary>
      </FrameworkScope>
    </FrameworkScope>
  );
};

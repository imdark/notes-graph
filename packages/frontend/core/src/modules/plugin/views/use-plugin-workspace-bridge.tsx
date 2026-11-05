import { useService } from '@notesgraph/infra';
import { useEffect } from 'react';

import {
  AgentRunSessionService,
  AgentsService,
  RemoteAgentRunnerService,
} from '../../agents';
import { DocsService } from '../../doc';
import { WorkspaceService } from '../../workspace';
import { PluginContextFactory } from '../services/context-factory';
import { PluginService } from '../services/plugin';

/**
 * Boots the plugin host at startup and bridges the active workspace's
 * `DocsService` into the (root-scoped) plugin context factory, so the plugin
 * `docs` capability acts on the current workspace. Render once inside a
 * workspace scope.
 */
export function usePluginWorkspaceBridge() {
  // Resolving PluginService instantiates the (lazy) service so its restore()
  // runs on load — otherwise installed plugins only activate when the
  // Settings → Plugins page is opened.
  useService(PluginService);
  const factory = useService(PluginContextFactory);
  const docsService = useService(DocsService);
  const agentsService = useService(AgentsService);
  const runSession = useService(AgentRunSessionService);
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceService = useService(WorkspaceService);

  useEffect(() => {
    factory.setActiveDocs(docsService);
    return () => {
      factory.setActiveDocs(null);
    };
  }, [factory, docsService]);

  // The same for the `agents` capability: this workspace's agents and runs,
  // and the registry's devices that take agent work.
  useEffect(() => {
    const workspaceId = workspaceService.workspace.id;
    factory.setActiveAgents({
      agents: agentsService,
      runs: runSession,
      devices: () => remoteRunner.agentTargets(workspaceId),
    });
    return () => {
      factory.setActiveAgents(null);
    };
  }, [factory, agentsService, runSession, remoteRunner, workspaceService]);
}

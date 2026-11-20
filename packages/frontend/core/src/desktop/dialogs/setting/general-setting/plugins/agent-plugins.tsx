import { Button, notify } from '@notesgraph/component';
import {
  SettingRow,
  SettingWrapper,
} from '@notesgraph/component/setting-components';
import { FetchService, ServerService } from '@notesgraph/core/modules/cloud';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import {
  type AgentPluginEntry,
  agentPluginUrl,
  listAgentPlugins,
  PluginService,
} from '@notesgraph/core/modules/plugin';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService, useServiceOptional } from '@notesgraph/infra';
import { useCallback, useEffect, useState } from 'react';

/**
 * Plugins agents wrote for the open workspace with the create_plugin MCP
 * tool. Nothing runs until the user installs one here; after that it is an
 * ordinary installed plugin that reloads from the server on every start.
 */
export const AgentPluginsSection = () => {
  const workspaceService = useServiceOptional(WorkspaceService);
  const flags = useService(FeatureFlagService).flags;
  const enabled = useLiveData(flags.enable_agent_plugins.$);
  // Outside a workspace (or a local one) there is no server to ask.
  if (!enabled || !workspaceService) return null;
  if (workspaceService.workspace.flavour === 'local') return null;
  return <AgentPluginsList workspaceId={workspaceService.workspace.id} />;
};

const AgentPluginsList = ({ workspaceId }: { workspaceId: string }) => {
  const pluginService = useService(PluginService);
  const fetchService = useService(FetchService);
  const serverService = useService(ServerService);
  const installed = useLiveData(pluginService.plugins$);
  const [entries, setEntries] = useState<AgentPluginEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    setEntries(null);
    listAgentPlugins(fetchService, workspaceId)
      .then(setEntries)
      .catch((err: unknown) => {
        setEntries([]);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [fetchService, workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const install = useCallback(
    (entry: AgentPluginEntry) => {
      setBusyId(entry.id);
      pluginService
        .loadFromUrl(
          agentPluginUrl(entry, serverService.server.baseUrl),
          'agent'
        )
        .then(() => setBusyId(null))
        .catch((err: unknown) => {
          setBusyId(null);
          notify.error({
            title: `Could not load ${entry.manifest.name}`,
            message: err instanceof Error ? err.message : String(err),
          });
        });
    },
    [pluginService, serverService]
  );

  return (
    <SettingWrapper title="Made by agents">
      {entries === null ? (
        <SettingRow name="Loading…" desc="Fetching this workspace's plugins." />
      ) : error ? (
        <SettingRow name="Could not list agent plugins" desc={error}>
          <Button onClick={refresh}>Try again</Button>
        </SettingRow>
      ) : entries.length === 0 ? (
        <SettingRow
          name="No agent plugins yet"
          desc="Ask an agent to make one: it writes the plugin with its create_plugin tool, and it shows up here to install."
        />
      ) : (
        entries.map(entry => {
          const current = installed.find(p => p.manifest.id === entry.id);
          const label = !current
            ? 'Install'
            : current.manifest.version !== entry.version
              ? `Update to v${entry.version}`
              : 'Installed';
          const permissions = entry.manifest.permissions.length
            ? `uses ${entry.manifest.permissions.join(', ')}`
            : 'asks for no permissions';
          return (
            <SettingRow
              key={entry.id}
              name={entry.manifest.name}
              desc={[
                `v${entry.version}`,
                entry.agent ? `by ${entry.agent}` : null,
                permissions,
                entry.manifest.description,
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              <Button
                variant={label === 'Installed' ? 'secondary' : 'primary'}
                disabled={label === 'Installed'}
                loading={busyId === entry.id}
                onClick={() => install(entry)}
              >
                {label}
              </Button>
            </SettingRow>
          );
        })
      )}
    </SettingWrapper>
  );
};

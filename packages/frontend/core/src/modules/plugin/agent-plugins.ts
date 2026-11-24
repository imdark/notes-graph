import type { PluginManifest } from '@notesgraph/plugin-sdk';

import type { FetchService } from '../cloud';

/** A plugin an agent wrote for a workspace (the server's create_plugin MCP tool). */
export interface AgentPluginEntry {
  id: string;
  version: string;
  manifest: PluginManifest;
  agent: string | null;
  updatedAt: string;
  /** Server-relative base the files are served under, e.g. `/api/agent-plugins/<token>`. */
  baseUrl: string;
}

export async function listAgentPlugins(
  fetchService: FetchService,
  workspaceId: string
): Promise<AgentPluginEntry[]> {
  const res = await fetchService.fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-plugins`,
    { cache: 'no-store' }
  );
  const data = (await res.json()) as { plugins: AgentPluginEntry[] };
  return data.plugins;
}

/**
 * The absolute base PluginService loads the plugin from. `import()` resolves a
 * relative URL against the page, which on desktop and mobile is not the server.
 */
export function agentPluginUrl(
  entry: AgentPluginEntry,
  serverBaseUrl: string
): string {
  return new URL(entry.baseUrl, serverBaseUrl).toString().replace(/\/+$/, '');
}

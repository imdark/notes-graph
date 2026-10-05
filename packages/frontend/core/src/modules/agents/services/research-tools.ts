import { Service } from '@notesgraph/infra';

import { FetchService, type WorkspaceServerService } from '../../cloud';
import type { FetchInit } from '../../cloud/services/fetch';
import type { AgentToolSpec } from './file-tools';

/**
 * The Research harness's tools: OmniSeek (github.com/Battam1111/omniseek)
 * search and reading tools, called through this workspace's server, which
 * keeps OmniSeek as a sidecar and only passes on the read-and-search ones.
 */

/** A search fans out across many sources; give it time before giving up. */
const CALL_TIMEOUT_MS = 3 * 60_000;

/** What the model is told about the research tools, beside the tool list. */
export const RESEARCH_TOOL_RULES = [
  'The omniseek_* tools research the outside world: omniseek_search searches',
  'many sources at once, across languages; omniseek_read reads a page, PDF or',
  'arXiv paper in full; the paper and graph tools follow citations and',
  'authors. Use omniseek_gather to run several of them in one step.',
  'Sweep broadly first, then read the best sources, then answer. Back every',
  'claim with its source URL, and say where sources disagree or where you',
  'found nothing.',
];

interface ServerTool {
  name: string;
  description: string;
  inputSchema?: { properties?: Record<string, { description?: string; type?: unknown }> };
}

/** A tool as the fenced-block protocol shows it: its args, with a hint each. */
export const toToolSpec = (tool: ServerTool): AgentToolSpec => ({
  name: tool.name,
  // The first sentence: the list goes into every step's prompt.
  desc: tool.description.split(/(?<=\.)\s/)[0].slice(0, 300),
  args: Object.fromEntries(
    Object.entries(tool.inputSchema?.properties ?? {}).map(([key, prop]) => [
      key,
      (prop.description || (typeof prop.type === 'string' ? prop.type : 'value'))
        .split(/(?<=\.)\s/)[0]
        .slice(0, 120),
    ])
  ),
  mutates: false,
});

export class ResearchToolsService extends Service {
  constructor(private readonly workspaceServerService: WorkspaceServerService) {
    super();
  }

  /** Reached through the server scope, as RemoteAgentRunnerService does. */
  private fetchService(): FetchService {
    const server = this.workspaceServerService.server;
    if (!server) {
      throw new Error(
        'This workspace is local, so there is no server to research through. Switch the agent to another runtime in Settings → Agents.'
      );
    }
    return server.scope.get(FetchService);
  }

  private async json<T>(path: string, init: FetchInit): Promise<T> {
    const response = await this.fetchService().fetchRaw(path, init);
    if (response.status === 404) {
      const body = await response.text();
      throw new Error(
        body.includes('not set up')
          ? "Research isn't set up on this server: it needs OmniSeek (NOTESGRAPH_OMNISEEK_URL)."
          : `Research API not found (${response.status}).`
      );
    }
    if (!response.ok) {
      throw new Error(`Research call failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  /** The research tools this server offers, ready for the tool prompt. */
  async specs(workspaceId: string): Promise<AgentToolSpec[]> {
    const { tools } = await this.json<{ tools: ServerTool[] }>(
      `/api/workspaces/${workspaceId}/research/tools`,
      { method: 'GET' }
    );
    return tools.map(toToolSpec);
  }

  /** Run one research tool; returns the text the model reads. */
  async call(
    workspaceId: string,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string> {
    const { text } = await this.json<{ text: string }>(
      `/api/workspaces/${workspaceId}/research/tools/${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args }),
        signal,
        timeout: CALL_TIMEOUT_MS,
      }
    );
    return text;
  }
}

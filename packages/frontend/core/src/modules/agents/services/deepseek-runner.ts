import { Service } from '@notesgraph/infra';

import { FetchService, type WorkspaceServerService } from '../../cloud';
import type { ChatModel } from './cloud-runner';

/**
 * Runs an agent's model calls on DeepSeek, through this workspace's server,
 * which holds the key (`plugins/research/deepseek-controller.ts`). As with
 * the cloud runner only the model call moves; the loop and the tools stay in
 * the tab, so a research agent on DeepSeek still searches and reads papers
 * with the OmniSeek tools.
 */

/** The DeepSeek models an agent can pick, as the server allows them. */
export const DEEPSEEK_MODELS = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3',
    category: 'DeepSeek via the server',
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek R1',
    category: 'DeepSeek via the server, thinks first: slower, more careful',
  },
];

export const isDeepSeekModel = (model: string | undefined): model is string =>
  DEEPSEEK_MODELS.some(m => m.id === model);

/** A reasoner step can think for minutes before its first word. */
const STEP_TIMEOUT_MS = 5 * 60_000;

export class DeepSeekRunnerService extends Service {
  constructor(private readonly workspaceServerService: WorkspaceServerService) {
    super();
  }

  /** Reached through the server scope, as ResearchToolsService does. */
  private fetchService(): FetchService {
    const server = this.workspaceServerService.server;
    if (!server) {
      throw new Error(
        'This workspace is local, so there is no server to reach DeepSeek through. Switch the agent to on-device in Settings → Agents.'
      );
    }
    return server.scope.get(FetchService);
  }

  /**
   * A model for one run. DeepSeek keeps no session, so every step sends the
   * whole conversation.
   */
  open(workspaceId: string, model: string): ChatModel {
    const fetchService = this.fetchService();
    return async function* (messages, signal) {
      const response = await fetchService.fetchRaw(
        `/api/workspaces/${workspaceId}/research/deepseek/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages }),
          signal,
          timeout: STEP_TIMEOUT_MS,
        }
      );
      if (response.status === 404) {
        const body = await response.text();
        throw new Error(
          body.includes('not set up')
            ? "DeepSeek isn't set up on this server: it needs NOTESGRAPH_DEEPSEEK_API_KEY."
            : `DeepSeek API not found (${response.status}).`
        );
      }
      if (!response.ok || !response.body) {
        throw new Error(
          `DeepSeek call failed (${response.status}): ${(await response.text()).slice(0, 200)}`
        );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          if (text) yield text;
        }
        const rest = decoder.decode();
        if (rest) yield rest;
      } finally {
        reader.releaseLock();
      }
    };
  }
}

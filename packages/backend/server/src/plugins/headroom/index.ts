/**
 * Headroom as a plugin: context compression through a Headroom proxy, and
 * response compression through a steering line at the end of the system
 * prompt. The copilot providers and the agent-job registry call these; each
 * is a no-op while its setting is off. See config.ts for the settings.
 */
import './config';

import type { LlmBackendConfig } from '../../native';
import type { PromptMessage } from '../copilot/providers/types';

export interface HeadroomSettings {
  copilot: boolean;
  proxyUrl: string;
  agentRuns: boolean;
  terseResponses: boolean;
}

/**
 * Headroom's verbosity steering, in our words. It goes at the end of the
 * system prompt so the cached prefix before it stays the same, and it only
 * cuts the talk around an answer, never what the user asked to be written.
 */
export const TERSE_STEERING =
  'Be concise. Skip preamble and closing recaps, and do not restate the ' +
  'question, files or tool output you were given. This does not shorten ' +
  'content the user asked you to write.';

/** The official endpoints, without `/v1`, as the providers build them. */
const OFFICIAL_UPSTREAMS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
};

const trimSlash = (url: string) => url.trim().replace(/\/+$/, '');

/**
 * The backend config with its base URL pointed at the Headroom proxy, which
 * forwards to the official API. Only an Anthropic or OpenAI provider talking
 * to the official endpoint is rerouted: the proxy cannot forward to a custom
 * base URL (a gateway, Vertex, an OpenAI-compatible host).
 */
export function routeThroughHeadroom(
  providerType: string,
  backendConfig: LlmBackendConfig,
  settings: HeadroomSettings | undefined
): LlmBackendConfig {
  const proxy = settings?.copilot ? trimSlash(settings.proxyUrl ?? '') : '';
  const official = OFFICIAL_UPSTREAMS[providerType];
  if (!proxy || !official) return backendConfig;
  if (trimSlash(backendConfig.base_url ?? '') !== official)
    return backendConfig;
  return { ...backendConfig, base_url: proxy };
}

/**
 * The messages with the steering line added to the end of the first system
 * message. A conversation with no system message is left as it is.
 */
export function steerTerse(
  messages: PromptMessage[],
  settings: HeadroomSettings | undefined
): PromptMessage[] {
  if (!settings?.terseResponses) return messages;
  const index = messages.findIndex(m => m.role === 'system');
  if (index < 0) return messages;
  const system = messages[index];
  if (system.content.includes(TERSE_STEERING)) return messages;
  const steered = [...messages];
  steered[index] = {
    ...system,
    content: `${system.content.trimEnd()}\n\n${TERSE_STEERING}`,
  };
  return steered;
}

/** What an agent run's profile carries about Headroom; see agent-profiles.ts. */
export interface AgentHeadroom {
  /** Send Claude Code through the runner's Headroom proxy. */
  compressContext: boolean;
}

/**
 * A run profile with Headroom applied: the runner is told to use its proxy,
 * and the steering line ends the appended system prompt.
 */
export function withHeadroom<
  P extends { systemPrompt: string; headroom?: AgentHeadroom },
>(profile: P, settings: HeadroomSettings | undefined): P {
  if (!settings) return profile;
  let next = profile;
  if (settings.agentRuns) {
    next = { ...next, headroom: { compressContext: true } };
  }
  if (settings.terseResponses && !next.systemPrompt.includes(TERSE_STEERING)) {
    next = {
      ...next,
      systemPrompt: `${next.systemPrompt.trimEnd()}\n\n${TERSE_STEERING}`,
    };
  }
  return next;
}

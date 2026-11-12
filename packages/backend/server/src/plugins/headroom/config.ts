import { z } from 'zod';

import { defineModuleConfig } from '../../base';

declare global {
  interface AppConfigSchema {
    headroom: {
      copilot: ConfigItem<boolean>;
      proxyUrl: ConfigItem<string>;
      agentRuns: ConfigItem<boolean>;
      terseResponses: ConfigItem<boolean>;
    };
  }
}

/**
 * Headroom (github.com/headroomlabs-ai/headroom) compresses what a model reads
 * (tool output, logs, JSON, history) in a local proxy that sits in front of
 * the Anthropic and OpenAI APIs. Everything here is off by default.
 *
 * Start the proxy with telemetry off, e.g.
 *   HEADROOM_TELEMETRY=off headroom proxy --port 8787
 */
defineModuleConfig('headroom', {
  copilot: {
    desc: "Send the AI assistant's Anthropic and OpenAI calls through the Headroom proxy at proxyUrl, which compresses their context. Providers set to a custom base URL are left alone.",
    default: false,
    schema: z.boolean(),
    env: ['NOTESGRAPH_HEADROOM_COPILOT', 'boolean'],
  },
  proxyUrl: {
    desc: 'The Headroom proxy the server reaches, e.g. http://127.0.0.1:8787.',
    default: 'http://127.0.0.1:8787',
    schema: z.string(),
    env: ['NOTESGRAPH_HEADROOM_PROXY_URL', 'string'],
  },
  agentRuns: {
    desc: "Ask agent runners to send Claude Code through their own Headroom proxy (the runner's RUNNER_HEADROOM_URL). A runner with no proxy running goes on without it.",
    default: false,
    schema: z.boolean(),
    env: ['NOTESGRAPH_HEADROOM_AGENT_RUNS', 'boolean'],
  },
  terseResponses: {
    desc: 'Shorter answers: add a line to the end of the system prompt (AI assistant chat and agent runs) asking the model to skip preamble, recaps and restating its context.',
    default: false,
    schema: z.boolean(),
    env: ['NOTESGRAPH_HEADROOM_TERSE', 'boolean'],
  },
});

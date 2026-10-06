import { z } from 'zod';

import { defineModuleConfig } from '../../base';

declare global {
  interface AppConfigSchema {
    research: {
      omniseekUrl: ConfigItem<string>;
      omniseekToken: ConfigItem<string>;
      deepseekApiKey: ConfigItem<string>;
      deepseekUrl: ConfigItem<string>;
    };
  }
}

/**
 * The OmniSeek service the Research harness reaches through this server
 * (github.com/Battam1111/omniseek): a sidecar on the same compose network,
 * never exposed on its own. An empty URL turns the research API off.
 *
 * As with the inventory settings, a row in `app_configs` wins over the env.
 */
defineModuleConfig('research', {
  omniseekUrl: {
    desc: 'Base URL of the OmniSeek MCP service, e.g. http://omniseek:8765. Empty disables research.',
    default: '',
    schema: z.string(),
    env: ['NOTESGRAPH_OMNISEEK_URL', 'string'],
  },
  omniseekToken: {
    desc: "Bearer token for OmniSeek (its ~/.omniseek/credentials/omniseek_http.json 'token').",
    default: '',
    schema: z.string(),
    env: ['NOTESGRAPH_OMNISEEK_TOKEN', 'string'],
  },
  // DeepSeek as a model for cloud and research agents, alongside (or in
  // place of) the server's copilot. An empty key turns it off.
  deepseekApiKey: {
    desc: 'DeepSeek API key, so cloud and research agents can run on DeepSeek. Empty disables it.',
    default: '',
    schema: z.string(),
    env: ['NOTESGRAPH_DEEPSEEK_API_KEY', 'string'],
  },
  deepseekUrl: {
    desc: 'Base URL of the DeepSeek (OpenAI-compatible) chat API.',
    default: 'https://api.deepseek.com',
    schema: z.string(),
    env: ['NOTESGRAPH_DEEPSEEK_URL', 'string'],
  },
});

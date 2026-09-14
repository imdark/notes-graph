import { z } from 'zod';

import { defineModuleConfig, JSONSchema } from '../../base';

export interface DirectoryGoogleConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  requestTimeoutMs?: number;
}

declare global {
  interface AppConfigSchema {
    directory: {
      google: ConfigItem<DirectoryGoogleConfig>;
    };
  }
}

const schema: JSONSchema = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    clientId: { type: 'string' },
    clientSecret: { type: 'string' },
    requestTimeoutMs: { type: 'number' },
  },
};

defineModuleConfig('directory', {
  google: {
    desc: 'Google Workspace directory sync integration config',
    default: {
      enabled: false,
      clientId: '',
      clientSecret: '',
      requestTimeoutMs: 10_000,
    },
    schema,
    shape: z.object({
      enabled: z.boolean(),
      clientId: z.string(),
      clientSecret: z.string(),
      requestTimeoutMs: z.number().int().positive().optional(),
    }),
    link: 'https://developers.google.com/admin-sdk/directory/v1/guides/delegation',
  },
});

import { z } from 'zod';

import { defineModuleConfig } from '../../base';

export interface RegistryConfig {
  /** Turns the /api/registry endpoints on. Off by default. */
  enabled: boolean;
  /** Upper bound on devices per workspace, to keep a looping CLI honest. */
  maxDevicesPerWorkspace: number;
  /**
   * Firebase service-account key (the whole JSON file, as a string) used to
   * push "an agent is waiting on you" to phones. Empty turns push off; the
   * questions still wait in the app.
   */
  fcmServiceAccount: string;
}

declare global {
  interface AppConfigSchema {
    registry: {
      enabled: ConfigItem<boolean>;
      maxDevicesPerWorkspace: ConfigItem<number>;
      fcmServiceAccount: ConfigItem<string>;
    };
  }
}

/**
 * Both settings carry an `env` mapping so a self-hosted instance is configured
 * the way the rest of the stack is - in `.env` next to NOTESGRAPH_INDEXER_*.
 *
 * Note the precedence: AppConfigService.setup() applies database overrides
 * from `app_configs` AFTER env parsing, so a stored row wins over the
 * variable. If a row exists for one of these keys, the env var below is
 * ignored - delete the row rather than fighting it.
 */
// Pre-rename variable names, still read so an existing `.env` keeps working.
for (const [legacy, current] of [
  ['NOTESGRAPH_INVENTORY_ENABLED', 'NOTESGRAPH_REGISTRY_ENABLED'],
  ['NOTESGRAPH_INVENTORY_MAX_DEVICES', 'NOTESGRAPH_REGISTRY_MAX_DEVICES'],
]) {
  if (process.env[current] === undefined && process.env[legacy] !== undefined) {
    process.env[current] = process.env[legacy];
  }
}

defineModuleConfig('registry', {
  enabled: {
    desc: 'Enable the device registry API for deployment and agent targets.',
    default: false,
    schema: z.boolean(),
    env: ['NOTESGRAPH_REGISTRY_ENABLED', 'boolean'],
  },
  maxDevicesPerWorkspace: {
    desc: 'Maximum number of registry devices a single workspace may hold.',
    default: 500,
    schema: z.number().int().positive(),
    env: ['NOTESGRAPH_REGISTRY_MAX_DEVICES', 'integer'],
  },
  fcmServiceAccount: {
    desc: 'Firebase service-account JSON for pushing agent questions to phones. Empty disables push.',
    default: '',
    schema: z.string(),
    env: ['NOTESGRAPH_FCM_SERVICE_ACCOUNT', 'string'],
  },
});

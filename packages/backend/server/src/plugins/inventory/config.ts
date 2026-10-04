import { z } from 'zod';

import { defineModuleConfig } from '../../base';

export interface InventoryConfig {
  /** Turns the /api/inventory endpoints on. Off by default. */
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
    inventory: {
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
defineModuleConfig('inventory', {
  enabled: {
    desc: 'Enable the device inventory API for deployment and agent targets.',
    default: false,
    schema: z.boolean(),
    env: ['NOTESGRAPH_INVENTORY_ENABLED', 'boolean'],
  },
  maxDevicesPerWorkspace: {
    desc: 'Maximum number of inventory devices a single workspace may hold.',
    default: 500,
    schema: z.number().int().positive(),
    env: ['NOTESGRAPH_INVENTORY_MAX_DEVICES', 'integer'],
  },
  fcmServiceAccount: {
    desc: 'Firebase service-account JSON for pushing agent questions to phones. Empty disables push.',
    default: '',
    schema: z.string(),
    env: ['NOTESGRAPH_FCM_SERVICE_ACCOUNT', 'string'],
  },
});

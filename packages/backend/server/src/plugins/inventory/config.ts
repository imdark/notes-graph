import { z } from 'zod';

import { defineModuleConfig } from '../../base';

export interface InventoryConfig {
  /** Turns the /api/inventory endpoints on. Off by default. */
  enabled: boolean;
  /** Upper bound on devices per workspace, to keep a looping CLI honest. */
  maxDevicesPerWorkspace: number;
}

declare global {
  interface AppConfigSchema {
    inventory: {
      enabled: ConfigItem<boolean>;
      maxDevicesPerWorkspace: ConfigItem<number>;
    };
  }
}

defineModuleConfig('inventory', {
  enabled: {
    desc: 'Enable the device inventory API for deployment and agent targets.',
    default: false,
    schema: z.boolean(),
  },
  maxDevicesPerWorkspace: {
    desc: 'Maximum number of inventory devices a single workspace may hold.',
    default: 500,
    schema: z.number().int().positive(),
  },
});

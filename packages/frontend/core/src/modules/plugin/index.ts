import type { Framework } from '@notesgraph/infra';

import { GlobalContextService } from '../global-context';
import { ImportRegistryService } from '../import';
import { GlobalState } from '../storage';
import { PluginContextFactory } from './services/context-factory';
import { PluginContributionRegistry } from './services/contribution-registry';
import { PluginMarketplaceService } from './services/marketplace';
import { PluginService } from './services/plugin';

export type { MarketplaceEntry } from './marketplace';
export { PluginContextFactory } from './services/context-factory';
export { PluginContributionRegistry } from './services/contribution-registry';
export { PluginMarketplaceService } from './services/marketplace';
export { type InstalledPlugin, PluginService } from './services/plugin';
export { PluginSidebarTabs } from './views/plugin-sidebar-tabs';
export { usePluginHostEvents } from './views/use-plugin-host-events';
export { usePluginWorkspaceBridge } from './views/use-plugin-workspace-bridge';
export { useRegisterPluginCommands } from './views/use-register-plugin-commands';

export function configurePluginModule(framework: Framework) {
  framework
    .service(PluginContributionRegistry)
    .service(PluginContextFactory, [
      PluginContributionRegistry,
      GlobalState,
      GlobalContextService,
      ImportRegistryService,
    ])
    .service(PluginService, [PluginContextFactory, GlobalState])
    .service(PluginMarketplaceService, [PluginService]);
}

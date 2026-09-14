import { OnEvent, Service } from '@notesgraph/infra';

import { ApplicationStarted } from '../../lifecycle';
import type { PluginService } from '../../plugin';
import { edgelessPluginDefinition } from '../definition';
import { edgelessManifest } from '../manifest';

/**
 * Registers the first-party edgeless plugin as a built-in on app start. It is
 * registered disabled by default; {@link PluginService.registerBuiltin} restores
 * the user's last enable choice. While enabled, the plugin contributes the
 * edgeless doc mode to the DocModeRegistryService, which every mode-aware
 * surface reads — so edgeless is entirely absent (not just hidden) when off.
 */
@OnEvent(ApplicationStarted, e => e.register)
export class EdgelessPluginService extends Service {
  constructor(private readonly pluginService: PluginService) {
    super();
  }

  register() {
    this.pluginService.registerBuiltin(
      edgelessManifest,
      edgelessPluginDefinition
    );
  }
}

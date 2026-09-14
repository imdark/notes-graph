import type { Framework } from '@notesgraph/infra';

import { PluginService } from '../plugin';
import { EdgelessPluginService } from './services/edgeless-plugin';

export { EDGELESS_PLUGIN_ID, edgelessManifest } from './manifest';
export { EdgelessPluginService } from './services/edgeless-plugin';

export function configureEdgelessPluginModule(framework: Framework) {
  framework.service(EdgelessPluginService, [PluginService]);
}

import { ViewExtensionManager } from '@blocksuite/notesgraph/ext-loader';
import { getEdgelessViewExtensions } from '@blocksuite/notesgraph/extensions/edgeless-view';
import { getInternalViewExtensions } from '@blocksuite/notesgraph/extensions/view';

// Edgeless is a plugin the app loads only when it's enabled; the playground
// and the integration tests exercise it, so they always load it.
const manager = new ViewExtensionManager([
  ...getInternalViewExtensions(),
  ...getEdgelessViewExtensions(),
]);

export function getTestViewManager() {
  return manager;
}

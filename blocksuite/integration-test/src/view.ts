import { ViewExtensionManager } from '@blocksuite/notesgraph/ext-loader';
import { getInternalViewExtensions } from '@blocksuite/notesgraph/extensions/view';

const manager = new ViewExtensionManager(getInternalViewExtensions());

export function getTestViewManager() {
  return manager;
}

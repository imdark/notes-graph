import { StoreExtensionManager } from '@blocksuite/notesgraph/ext-loader';
import { getInternalStoreExtensions } from '@blocksuite/notesgraph/extensions/store';

const manager = new StoreExtensionManager(getInternalStoreExtensions());

export function getTestStoreManager() {
  return manager;
}

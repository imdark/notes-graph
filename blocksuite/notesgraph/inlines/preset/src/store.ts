import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';

import { InlineAdapterExtensions } from './adapters/extensions';

export class InlinePresetStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-inline-preset';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(InlineAdapterExtensions);
  }
}

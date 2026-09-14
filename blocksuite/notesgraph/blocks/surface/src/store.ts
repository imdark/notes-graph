import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';

import { EdgelessSurfaceBlockAdapterExtensions } from './adapters';
import { SurfaceBlockSchemaExtension } from './surface-model';

export class SurfaceStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-surface-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(SurfaceBlockSchemaExtension);
    context.register(EdgelessSurfaceBlockAdapterExtensions);
  }
}

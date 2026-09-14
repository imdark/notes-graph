import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import { SurfaceRefBlockSchemaExtension } from '@blocksuite/notesgraph-model';

export class SurfaceRefStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-surface-ref-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(SurfaceRefBlockSchemaExtension);
  }
}

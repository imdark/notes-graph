import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import { EdgelessTextBlockSchemaExtension } from '@blocksuite/notesgraph-model';

export class EdgelessTextStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-edgeless-text-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(EdgelessTextBlockSchemaExtension);
  }
}

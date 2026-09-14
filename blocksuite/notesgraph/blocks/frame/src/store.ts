import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import { FrameBlockSchemaExtension } from '@blocksuite/notesgraph-model';

export class FrameStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-frame-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register([FrameBlockSchemaExtension]);
  }
}

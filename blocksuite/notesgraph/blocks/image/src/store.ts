import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import { ImageBlockSchemaExtension } from '@blocksuite/notesgraph-model';
import { ImageSelectionExtension } from '@blocksuite/notesgraph-shared/selection';

import { ImageBlockAdapterExtensions } from './adapters/extension';

export class ImageStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-image-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register([ImageBlockSchemaExtension, ImageSelectionExtension]);
    context.register(ImageBlockAdapterExtensions);
  }
}

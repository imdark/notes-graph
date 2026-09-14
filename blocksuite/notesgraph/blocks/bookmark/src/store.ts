import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import { BookmarkBlockSchemaExtension } from '@blocksuite/notesgraph-model';

import { BookmarkBlockAdapterExtensions } from './adapters/extension';

export class BookmarkStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-bookmark-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(BookmarkBlockSchemaExtension);
    context.register(BookmarkBlockAdapterExtensions);
  }
}

import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';

import { DataViewBlockSchemaExtension } from './data-view-model';

export class DataViewStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-data-view-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(DataViewBlockSchemaExtension);
  }
}

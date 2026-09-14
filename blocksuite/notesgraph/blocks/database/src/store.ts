import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import { DatabaseBlockSchemaExtension } from '@blocksuite/notesgraph-model';

import { DatabaseBlockAdapterExtensions } from './adapters/extension';
import { DatabaseSelectionExtension } from './selection';

export class DatabaseStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-database-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(DatabaseBlockSchemaExtension);
    context.register(DatabaseSelectionExtension);
    context.register(DatabaseBlockAdapterExtensions);
  }
}

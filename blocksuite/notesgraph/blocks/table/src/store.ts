import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import { TableBlockSchemaExtension } from '@blocksuite/notesgraph-model';

import { TableBlockAdapterExtensions } from './adapters/extension';
import { TableSelectionExtension } from './selection-schema';

export class TableStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-table-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(TableBlockSchemaExtension);
    context.register(TableBlockAdapterExtensions);
    context.register(TableSelectionExtension);
  }
}

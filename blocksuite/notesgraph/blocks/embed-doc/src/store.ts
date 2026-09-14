import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import {
  EmbedLinkedDocBlockSchemaExtension,
  EmbedSyncedBlockSchemaExtension,
  EmbedSyncedDocBlockSchemaExtension,
} from '@blocksuite/notesgraph-model';

import { EmbedLinkedDocBlockAdapterExtensions } from './embed-linked-doc-block/adapters/extension';
import { EmbedSyncedDocBlockAdapterExtensions } from './embed-synced-doc-block/adapters/extension';

export class EmbedDocStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-embed-doc-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register([
      EmbedSyncedDocBlockSchemaExtension,
      EmbedLinkedDocBlockSchemaExtension,
      EmbedSyncedBlockSchemaExtension,
    ]);
    context.register(EmbedLinkedDocBlockAdapterExtensions);
    context.register(EmbedSyncedDocBlockAdapterExtensions);
  }
}

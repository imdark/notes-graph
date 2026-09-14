import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import { ParagraphBlockSchemaExtension } from '@blocksuite/notesgraph-model';

import { ParagraphBlockAdapterExtensions } from './adapters/extension';

export class ParagraphStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-paragraph-block';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(ParagraphBlockSchemaExtension);
    context.register(ParagraphBlockAdapterExtensions);
  }
}

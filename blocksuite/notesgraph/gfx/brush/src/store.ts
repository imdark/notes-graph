import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';

import {
  brushToMarkdownAdapterMatcher,
  brushToPlainTextAdapterMatcher,
} from './adapter';

export class BrushStoreExtension extends StoreExtensionProvider {
  override name = 'notesgraph-brush-gfx';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(brushToMarkdownAdapterMatcher);
    context.register(brushToPlainTextAdapterMatcher);
  }
}

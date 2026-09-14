import { ViewExtensionProvider } from '@blocksuite/notesgraph-ext-loader';

import { effects } from './effects';

export class OutlineViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-outline-fragment';

  override effect() {
    super.effect();
    effects();
  }
}

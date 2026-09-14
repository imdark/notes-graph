import { ViewExtensionProvider } from '@blocksuite/notesgraph-ext-loader';

import { effects } from './effects';

export class DocTitleViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-doc-title-fragment';

  override effect() {
    super.effect();
    effects();
  }
}

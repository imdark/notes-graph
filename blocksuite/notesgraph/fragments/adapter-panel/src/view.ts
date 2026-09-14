import { ViewExtensionProvider } from '@blocksuite/notesgraph-ext-loader';

import { effects } from './effects';

export class AdapterPanelViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-adapter-panel-fragment';

  override effect() {
    super.effect();
    effects();
  }
}

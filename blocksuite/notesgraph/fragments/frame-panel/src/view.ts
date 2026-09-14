import { ViewExtensionProvider } from '@blocksuite/notesgraph-ext-loader';

import { effects } from './effects';

export class FramePanelViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-frame-panel-fragment';

  override effect() {
    super.effect();
    effects();
  }
}

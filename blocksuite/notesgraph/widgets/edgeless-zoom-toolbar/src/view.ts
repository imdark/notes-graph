import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';

import { effects } from './effects';
import { edgelessZoomToolbarWidget } from './index';

export class EdgelessZoomToolbarViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-edgeless-zoom-toolbar-widget';

  override effect() {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    if (this.isEdgeless(context.scope)) {
      context.register(edgelessZoomToolbarWidget);
    }
  }
}

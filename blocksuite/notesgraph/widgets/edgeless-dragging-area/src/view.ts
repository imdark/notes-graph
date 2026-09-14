import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';

import { edgelessDraggingAreaWidget } from './edgeless-dragging-area-rect';
import { effects } from './effects';

export class EdgelessDraggingAreaViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-edgeless-dragging-area-widget';

  override effect() {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    if (this.isEdgeless(context.scope)) {
      context.register(edgelessDraggingAreaWidget);
    }
  }
}

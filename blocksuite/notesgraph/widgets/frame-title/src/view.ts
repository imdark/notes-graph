import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';

import { effects } from './effects';
import { frameTitleWidget } from './notesgraph-frame-title-widget';

export class FrameTitleViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-frame-title-widget';

  override effect() {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    if (context.scope === 'edgeless') {
      context.register(frameTitleWidget);
    }
  }
}

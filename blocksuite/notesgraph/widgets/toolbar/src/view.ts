import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';

import { toolbarWidget } from '.';
import { effects } from './effects';

export class ToolbarViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-toolbar-widget';

  override effect() {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    // Mobile uses the widget's built-in mobile mode (bottom-docked above the
    // keyboard, see IS_MOBILE branches in toolbar.ts) — without it a selected
    // link/bookmark card has no way to switch its view type at all.
    context.register(toolbarWidget);
  }
}

import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import { BlockViewIdentifier } from '@blocksuite/notesgraph/std';
import { literal } from 'lit/static-html.js';

import { FocusablePageRootBlock } from './focusable-page-root';
import { OutlineZoomStoreExtension } from './outline-zoom-service';

const TAG = 'notesgraph-focusable-page-root';

/**
 * Registers the outline-zoom focus service and overrides the editable page-root
 * view with {@link FocusablePageRootBlock}, so a focused subtree can be shown in
 * place. Must be added to the view manager after the default page-root view so
 * this registration wins.
 */
export class OutlineZoomViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-outline-zoom';

  override effect() {
    super.effect();
    if (!customElements.get(TAG)) {
      customElements.define(TAG, FocusablePageRootBlock);
    }
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    context.register(OutlineZoomStoreExtension);
    // Override (not re-add) the page view — BlockSuite forbids two BlockViews
    // for the same flavour, so we replace the default `notesgraph-page-root`.
    if (context.scope === 'page') {
      context.register({
        setup: di => {
          di.override(
            BlockViewIdentifier('notesgraph:page'),
            () => literal`notesgraph-focusable-page-root`
          );
        },
      });
    }
  }
}

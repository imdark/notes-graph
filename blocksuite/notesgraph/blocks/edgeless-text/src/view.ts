import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';
import { BlockViewExtension } from '@blocksuite/std';
import { literal } from 'lit/static-html.js';

import { EdgelessClipboardEdgelessTextConfig } from './edgeless-clipboard-config';
import { EdgelessTextInteraction } from './edgeless-text-block';
import { edgelessTextToolbarExtension } from './edgeless-toolbar';
import { effects } from './effects';

export class EdgelessTextViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-edgeless-text-block';

  override effect() {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    const isEdgeless = this.isEdgeless(context.scope);

    if (isEdgeless) {
      context.register([
        BlockViewExtension(
          'notesgraph:edgeless-text',
          literal`notesgraph-edgeless-text`
        ),
      ]);
      context.register(edgelessTextToolbarExtension);
      context.register(EdgelessClipboardEdgelessTextConfig);
      context.register(EdgelessTextInteraction);
    }
  }
}

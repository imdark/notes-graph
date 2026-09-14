import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';

import { effects } from './effects';
import {
  EdgelessClipboardEmbedLinkedDocConfig,
  EmbedLinkedDocInteraction,
  EmbedLinkedDocViewExtensions,
} from './embed-linked-doc-block';
import { EmbedSyncedBlockViewExtensions } from './embed-synced-block';
import {
  EdgelessClipboardEmbedSyncedDocConfig,
  EmbedSyncedDocViewExtensions,
} from './embed-synced-doc-block';
import { EmbedSyncedDocInteraction } from './embed-synced-doc-block/configs/edgeless-interaction';

export class EmbedDocViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-embed-doc-block';

  override effect(): void {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    context.register(EmbedLinkedDocViewExtensions);
    context.register(EmbedSyncedDocViewExtensions);
    context.register(EmbedSyncedBlockViewExtensions);
    const isEdgeless = this.isEdgeless(context.scope);
    if (isEdgeless) {
      context.register([
        EdgelessClipboardEmbedLinkedDocConfig,
        EdgelessClipboardEmbedSyncedDocConfig,
        EmbedLinkedDocInteraction,
        EmbedSyncedDocInteraction,
      ]);
    }
  }
}

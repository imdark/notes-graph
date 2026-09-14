import { AttachmentEmbedConfigIdentifier } from '@blocksuite/notesgraph/blocks/attachment';
import { Bound } from '@blocksuite/notesgraph/global/gfx';
import {
  EMBED_CARD_HEIGHT,
  EMBED_CARD_WIDTH,
} from '@blocksuite/notesgraph/shared/consts';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import type { ReactToLit } from '@notesgraph/component';
import { AttachmentEmbedPreview } from '@notesgraph/core/blocksuite/attachment-viewer/attachment-embed-preview';

export function patchForPDFEmbedView(reactToLit: ReactToLit): ExtensionType {
  return {
    setup: di => {
      di.override(AttachmentEmbedConfigIdentifier('pdf'), () => ({
        name: 'pdf',
        shouldShowStatus: true,
        check: (model, maxFileSize) =>
          model.props.type === 'application/pdf' &&
          model.props.size <= maxFileSize,
        action: model => {
          const bound = Bound.deserialize(model.props.xywh);
          bound.w = EMBED_CARD_WIDTH.pdf;
          bound.h = EMBED_CARD_HEIGHT.pdf;
          model.store.updateBlock(model, {
            embed: true,
            style: 'pdf',
            xywh: bound.serialize(),
          });
        },
        render: (model, _) =>
          reactToLit(<AttachmentEmbedPreview model={model} />, true),
      }));
    },
  };
}

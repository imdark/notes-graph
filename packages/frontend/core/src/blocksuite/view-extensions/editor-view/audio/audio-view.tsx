import { AttachmentEmbedConfigIdentifier } from '@blocksuite/notesgraph/blocks/attachment';
import type { ExtensionType } from '@blocksuite/store';
import type { ReactToLit } from '@notesgraph/component';
import { AttachmentEmbedPreview } from '@notesgraph/core/blocksuite/attachment-viewer/attachment-embed-preview';

export function patchForAudioEmbedView(reactToLit: ReactToLit): ExtensionType {
  return {
    setup: di => {
      // do not show audio block on mobile
      if (BUILD_CONFIG.isMobileEdition) {
        return;
      }
      di.override(AttachmentEmbedConfigIdentifier('audio'), () => ({
        name: 'audio',
        check: (model, maxFileSize) =>
          model.props.type.startsWith('audio/') &&
          model.props.size <= maxFileSize,
        render: (model, _) =>
          reactToLit(<AttachmentEmbedPreview model={model} />, false),
      }));
    },
  };
}

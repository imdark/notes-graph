import { EdgelessClipboardConfig } from '@blocksuite/notesgraph-block-surface';
import { type BlockSnapshot } from '@blocksuite/store';

export class EdgelessClipboardEmbedLoomConfig extends EdgelessClipboardConfig {
  static override readonly key = 'notesgraph:embed-loom';

  override createBlock(loomEmbed: BlockSnapshot): string | null {
    if (!this.surface) return null;
    const { xywh, style, url, caption, videoId, image, title, description } =
      loomEmbed.props;

    const embedLoomId = this.crud.addBlock(
      'notesgraph:embed-loom',
      {
        xywh,
        style,
        url,
        caption,
        videoId,
        image,
        title,
        description,
      },
      this.surface.model.id
    );
    return embedLoomId;
  }
}

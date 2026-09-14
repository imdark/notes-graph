import { EdgelessClipboardConfig } from '@blocksuite/notesgraph-block-surface';
import { type BlockSnapshot } from '@blocksuite/store';

export class EdgelessClipboardBookmarkConfig extends EdgelessClipboardConfig {
  static override readonly key = 'notesgraph:bookmark';

  override createBlock(bookmark: BlockSnapshot): string | null {
    if (!this.surface) return null;

    const { xywh, style, url, caption, description, icon, image, title } =
      bookmark.props;

    const bookmarkId = this.crud.addBlock(
      'notesgraph:bookmark',
      {
        xywh,
        style,
        url,
        caption,
        description,
        icon,
        image,
        title,
      },
      this.surface.model.id
    );
    return bookmarkId;
  }
}

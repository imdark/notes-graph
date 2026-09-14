import { EdgelessClipboardConfig } from '@blocksuite/notesgraph-block-surface';
import { type BlockSnapshot } from '@blocksuite/store';

export class EdgelessClipboardEmbedHtmlConfig extends EdgelessClipboardConfig {
  static override readonly key = 'notesgraph:embed-html';

  override createBlock(htmlEmbed: BlockSnapshot): string | null {
    if (!this.surface) return null;
    const { xywh, style, caption, html, design } = htmlEmbed.props;

    const embedHtmlId = this.crud.addBlock(
      'notesgraph:embed-html',
      {
        xywh,
        style,
        caption,
        html,
        design,
      },
      this.surface.model.id
    );
    return embedHtmlId;
  }
}

import { EdgelessClipboardConfig } from '@blocksuite/notesgraph/blocks/surface';
import type { BlockSnapshot } from '@blocksuite/notesgraph/store';
import { AIChatBlockSchema } from '@notesgraph/core/blocksuite/ai/blocks';

export class EdgelessClipboardAIChatConfig extends EdgelessClipboardConfig {
  static override readonly key = AIChatBlockSchema.model.flavour;

  override createBlock(block: BlockSnapshot): null | string {
    if (!this.surface) return null;
    const { xywh, scale, messages, sessionId, rootDocId, rootWorkspaceId } =
      block.props;
    const blockId = this.crud.addBlock(
      AIChatBlockSchema.model.flavour,
      {
        xywh,
        scale,
        messages,
        sessionId,
        rootDocId,
        rootWorkspaceId,
      },
      this.surface.model.id
    );
    return blockId;
  }
}

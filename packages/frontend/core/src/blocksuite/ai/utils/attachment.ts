import { AttachmentBlockModel } from '@blocksuite/notesgraph/model';
import type { BlockModel } from '@blocksuite/notesgraph/store';
import type { GfxModel } from '@blocksuite/std/gfx';

export function isAttachment(
  model: GfxModel | BlockModel
): model is AttachmentBlockModel {
  return model instanceof AttachmentBlockModel;
}

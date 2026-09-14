import type { FrameBlockModel } from '@blocksuite/notesgraph/model';
import type { Store } from '@blocksuite/notesgraph/store';

export function getFrameBlock(doc: Store) {
  const blocks = doc.getBlocksByFlavour('notesgraph:frame');
  return blocks.length !== 0 ? (blocks[0].model as FrameBlockModel) : null;
}

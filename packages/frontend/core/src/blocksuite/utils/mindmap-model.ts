import { MindmapElementModel } from '@blocksuite/notesgraph/model';
import type { GfxModel } from '@blocksuite/notesgraph/std/gfx';

// Lightweight gfx mindmap checks. Kept OUTSIDE `blocksuite/ai/` on purpose:
// the editor-config toolbar (in the bootstrap-constructed view manager) needs
// these, and importing them from under `blocksuite/ai/` would drag the whole
// ~10MB AI chunk into the initial page load.

export function isMindMapRoot(ele: GfxModel) {
  const group = ele?.group;
  return group instanceof MindmapElementModel && group.tree.element === ele;
}

export function isMindmapChild(ele: GfxModel) {
  return ele?.group instanceof MindmapElementModel && !isMindMapRoot(ele);
}

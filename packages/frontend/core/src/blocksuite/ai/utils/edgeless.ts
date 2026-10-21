import { SurfaceBlockModel } from '@blocksuite/notesgraph/blocks/surface';
import type {
  MindmapElementModel} from '@blocksuite/notesgraph/model';
import {
  NoteBlockModel,
  RootBlockModel,
  type ShapeElementModel,
} from '@blocksuite/notesgraph/model';
import { matchModels } from '@blocksuite/notesgraph/shared/utils';
import type { BlockComponent } from '@blocksuite/notesgraph/std';

export function mindMapToMarkdown(mindmap: MindmapElementModel) {
  let markdownStr = '';

  const traverse = (
    node: MindmapElementModel['tree']['children'][number],
    indent: number = 0
  ) => {
    const text = (node.element as ShapeElementModel).text?.toString() ?? '';

    markdownStr += `${'  '.repeat(indent)}- ${text}\n`;

    if (node.children) {
      node.children.forEach(node => traverse(node, indent + 2));
    }
  };

  traverse(mindmap.tree, 0);

  return markdownStr;
}

// Moved to a non-AI location so the editor-config toolbar can use them without
// pulling the AI chunk into the initial bundle; re-exported here for AI callers.
export { getEdgelessCopilotWidget } from './get-edgeless-copilot-widget';
export {
  isMindmapChild,
  isMindMapRoot,
} from '@notesgraph/core/blocksuite/utils/mindmap-model';

export function findNoteBlockModel(blockElement: BlockComponent) {
  let curBlock = blockElement;
  while (curBlock) {
    if (matchModels(curBlock.model, [NoteBlockModel])) {
      return curBlock.model;
    }
    if (matchModels(curBlock.model, [RootBlockModel, SurfaceBlockModel])) {
      return null;
    }
    if (!curBlock.parentComponent) {
      break;
    }
    curBlock = curBlock.parentComponent;
  }
  return null;
}

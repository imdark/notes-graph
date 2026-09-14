import type { CanvasElementWithText } from '@blocksuite/notesgraph-block-surface';
import type { PanTool } from '@blocksuite/notesgraph-gfx-pointer';
import {
  type AttachmentBlockModel,
  type Connectable,
  type EdgelessTextBlockModel,
  type EmbedSyncedDocModel,
  type ImageBlockModel,
  ShapeElementModel,
  TextElementModel,
} from '@blocksuite/notesgraph-model';
import { isTopLevelBlock } from '@blocksuite/notesgraph-shared/utils';
import type {
  GfxModel,
  GfxPrimitiveElementModel,
  ToolOptionWithType,
} from '@blocksuite/std/gfx';
import type { BlockModel } from '@blocksuite/store';

import { drawingCursor } from './cursors';

export function isEdgelessTextBlock(
  element: BlockModel | GfxModel | null
): element is EdgelessTextBlockModel {
  return (
    !!element &&
    'flavour' in element &&
    element.flavour === 'notesgraph:edgeless-text'
  );
}

export function isImageBlock(
  element: BlockModel | GfxModel | null
): element is ImageBlockModel {
  return (
    !!element && 'flavour' in element && element.flavour === 'notesgraph:image'
  );
}

export function isAttachmentBlock(
  element: BlockModel | GfxModel | null
): element is AttachmentBlockModel {
  return (
    !!element &&
    'flavour' in element &&
    element.flavour === 'notesgraph:attachment'
  );
}

export function isEmbedSyncedDocBlock(
  element: BlockModel | GfxModel | null
): element is EmbedSyncedDocModel {
  return (
    !!element &&
    'flavour' in element &&
    element.flavour === 'notesgraph:embed-synced-doc'
  );
}

export function isCanvasElement(
  selectable: GfxModel | BlockModel | null
): selectable is GfxPrimitiveElementModel {
  return !isTopLevelBlock(selectable);
}

export function isCanvasElementWithText(
  element: GfxModel
): element is CanvasElementWithText {
  return (
    element instanceof TextElementModel || element instanceof ShapeElementModel
  );
}

export function isConnectable(
  element: GfxModel | null
): element is Connectable {
  return !!element && element.connectable;
}

// https://developer.mozilla.org/en-US/docs/Web/CSS/cursor
export function getCursorMode(edgelessTool: ToolOptionWithType) {
  if (!edgelessTool) {
    return 'default';
  }
  switch (edgelessTool.toolType?.toolName) {
    case 'default':
      return 'default';
    case 'pan':
      return (edgelessTool as ToolOptionWithType<PanTool>).options?.panning
        ? 'grabbing'
        : 'grab';
    case 'brush':
    case 'highlighter':
      return drawingCursor;
    case 'eraser':
    case 'shape':
    case 'connector':
    case 'frame':
    case 'notesgraph:note':
      return 'crosshair';
    case 'text':
      return 'text';
    default:
      return 'default';
  }
}

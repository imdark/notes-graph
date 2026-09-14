import { SurfaceBlockSchema } from '@blocksuite/notesgraph/blocks/surface';
import { ConnectorElementRendererExtension } from '@blocksuite/notesgraph/gfx/connector';
import {
  MindmapElementRendererExtension,
  MindMapView,
} from '@blocksuite/notesgraph/gfx/mindmap';
import { ShapeElementRendererExtension } from '@blocksuite/notesgraph/gfx/shape';
import { TextElementRendererExtension } from '@blocksuite/notesgraph/gfx/text';
import { RootBlockSchema } from '@blocksuite/notesgraph/model';
import {
  DocModeService,
  ThemeService,
} from '@blocksuite/notesgraph/shared/services';
import {
  BlockViewExtension,
  FlavourExtension,
} from '@blocksuite/notesgraph/std';
import { ToolController } from '@blocksuite/notesgraph/std/gfx';
import type { BlockSchema, ExtensionType } from '@blocksuite/notesgraph/store';
import { literal } from 'lit/static-html.js';
import type { z } from 'zod';

import { MindmapService } from './mindmap-service.js';
import { MindmapSurfaceBlockService } from './surface-service.js';

export const MiniMindmapSpecs: ExtensionType[] = [
  DocModeService,
  ThemeService,
  FlavourExtension('notesgraph:page'),
  MindmapService,
  ToolController,
  BlockViewExtension('notesgraph:page', literal`mini-mindmap-root-block`),
  FlavourExtension('notesgraph:surface'),
  MindMapView,
  MindmapSurfaceBlockService,
  BlockViewExtension('notesgraph:surface', literal`mini-mindmap-surface-block`),
  TextElementRendererExtension,
  MindmapElementRendererExtension,
  ShapeElementRendererExtension,
  ConnectorElementRendererExtension,
];

export const MiniMindmapSchema: z.infer<typeof BlockSchema>[] = [
  RootBlockSchema,
  SurfaceBlockSchema,
];

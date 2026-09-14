import { EdgelessTextViewExtension } from '@blocksuite/notesgraph-block-edgeless-text/view';
import { BrushViewExtension } from '@blocksuite/notesgraph-gfx-brush/view';
import { ConnectorViewExtension } from '@blocksuite/notesgraph-gfx-connector/view';
import { GroupViewExtension } from '@blocksuite/notesgraph-gfx-group/view';
import { LinkViewExtension as GfxLinkViewExtension } from '@blocksuite/notesgraph-gfx-link/view';
import { MindmapViewExtension } from '@blocksuite/notesgraph-gfx-mindmap/view';
import { NoteViewExtension as GfxNoteViewExtension } from '@blocksuite/notesgraph-gfx-note/view';
import { PointerViewExtension } from '@blocksuite/notesgraph-gfx-pointer/view';
import { ShapeViewExtension } from '@blocksuite/notesgraph-gfx-shape/view';
import { TemplateViewExtension } from '@blocksuite/notesgraph-gfx-template/view';
import { TextViewExtension } from '@blocksuite/notesgraph-gfx-text/view';
import { EdgelessAutoConnectViewExtension } from '@blocksuite/notesgraph-widget-edgeless-auto-connect/view';
import { EdgelessDraggingAreaViewExtension } from '@blocksuite/notesgraph-widget-edgeless-dragging-area/view';
import { EdgelessSelectedRectViewExtension } from '@blocksuite/notesgraph-widget-edgeless-selected-rect/view';
import { EdgelessToolbarViewExtension } from '@blocksuite/notesgraph-widget-edgeless-toolbar/view';
import { EdgelessZoomToolbarViewExtension } from '@blocksuite/notesgraph-widget-edgeless-zoom-toolbar/view';

/**
 * Edgeless-only view extensions, split out of {@link getInternalViewExtensions}
 * so the edgeless (whiteboard) editor mode can be delivered as a separately
 * loaded, default-disabled plugin (see the core `edgeless-plugin` module).
 *
 * These providers self-gate via `isEdgeless(scope)` and are inert in plain page
 * mode; the surface/surface-ref blocks themselves stay in the always-on set, so
 * page docs keep working without this bundle. Because the bundle is imported
 * dynamically only when the edgeless plugin activates, the gfx/edgeless module
 * graph (and its lit custom-element effects) is not loaded until then.
 *
 * Order mirrors the relative ordering in `getInternalViewExtensions`; widget
 * order still affects edgeless-scope z-index.
 */
export function getEdgelessViewExtensions() {
  return [
    // Gfx
    PointerViewExtension,
    GfxNoteViewExtension,
    BrushViewExtension,
    ShapeViewExtension,
    MindmapViewExtension,
    ConnectorViewExtension,
    GroupViewExtension,
    TextViewExtension,
    TemplateViewExtension,
    GfxLinkViewExtension,

    // Block
    EdgelessTextViewExtension,

    // Widget (order affects z-index within the edgeless scope)
    EdgelessAutoConnectViewExtension,
    EdgelessZoomToolbarViewExtension,
    EdgelessSelectedRectViewExtension,
    EdgelessDraggingAreaViewExtension,
    EdgelessToolbarViewExtension,
  ];
}

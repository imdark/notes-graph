import { AttachmentViewExtension } from '@blocksuite/notesgraph-block-attachment/view';
import { BookmarkViewExtension } from '@blocksuite/notesgraph-block-bookmark/view';
import { CalloutViewExtension } from '@blocksuite/notesgraph-block-callout/view';
import { CodeBlockViewExtension } from '@blocksuite/notesgraph-block-code/view';
import { DataViewViewExtension } from '@blocksuite/notesgraph-block-data-view/view';
import { DatabaseViewExtension } from '@blocksuite/notesgraph-block-database/view';
import { DividerViewExtension } from '@blocksuite/notesgraph-block-divider/view';
import { EmbedViewExtension } from '@blocksuite/notesgraph-block-embed/view';
import { EmbedDocViewExtension } from '@blocksuite/notesgraph-block-embed-doc/view';
import { FrameViewExtension } from '@blocksuite/notesgraph-block-frame/view';
import { ImageViewExtension } from '@blocksuite/notesgraph-block-image/view';
import { LatexViewExtension } from '@blocksuite/notesgraph-block-latex/view';
import { ListViewExtension } from '@blocksuite/notesgraph-block-list/view';
import { NoteViewExtension } from '@blocksuite/notesgraph-block-note/view';
import { ParagraphViewExtension } from '@blocksuite/notesgraph-block-paragraph/view';
import { RootViewExtension } from '@blocksuite/notesgraph-block-root/view';
import { SurfaceViewExtension } from '@blocksuite/notesgraph-block-surface/view';
import { SurfaceRefViewExtension } from '@blocksuite/notesgraph-block-surface-ref/view';
import { TableViewExtension } from '@blocksuite/notesgraph-block-table/view';
import { FoundationViewExtension } from '@blocksuite/notesgraph-foundation/view';
import { AdapterPanelViewExtension } from '@blocksuite/notesgraph-fragment-adapter-panel/view';
import { DocTitleViewExtension } from '@blocksuite/notesgraph-fragment-doc-title/view';
import { FramePanelViewExtension } from '@blocksuite/notesgraph-fragment-frame-panel/view';
import { OutlineViewExtension } from '@blocksuite/notesgraph-fragment-outline/view';
import { InlineCommentViewExtension } from '@blocksuite/notesgraph-inline-comment/view';
import { FootnoteViewExtension } from '@blocksuite/notesgraph-inline-footnote/view';
import { LatexViewExtension as InlineLatexViewExtension } from '@blocksuite/notesgraph-inline-latex/view';
import { LinkViewExtension } from '@blocksuite/notesgraph-inline-link/view';
import { MentionViewExtension } from '@blocksuite/notesgraph-inline-mention/view';
import { InlinePresetViewExtension } from '@blocksuite/notesgraph-inline-preset/view';
import { ReferenceViewExtension } from '@blocksuite/notesgraph-inline-reference/view';
import { DragHandleViewExtension } from '@blocksuite/notesgraph-widget-drag-handle/view';
import { FrameTitleViewExtension } from '@blocksuite/notesgraph-widget-frame-title/view';
import { KeyboardToolbarViewExtension } from '@blocksuite/notesgraph-widget-keyboard-toolbar/view';
import { LinkedDocViewExtension } from '@blocksuite/notesgraph-widget-linked-doc/view';
import { NoteSlicerViewExtension } from '@blocksuite/notesgraph-widget-note-slicer/view';
import { PageDraggingAreaViewExtension } from '@blocksuite/notesgraph-widget-page-dragging-area/view';
import { RemoteSelectionViewExtension } from '@blocksuite/notesgraph-widget-remote-selection/view';
import { ScrollAnchoringViewExtension } from '@blocksuite/notesgraph-widget-scroll-anchoring/view';
import { SlashMenuViewExtension } from '@blocksuite/notesgraph-widget-slash-menu/view';
import { ToolbarViewExtension } from '@blocksuite/notesgraph-widget-toolbar/view';
import { ViewportOverlayViewExtension } from '@blocksuite/notesgraph-widget-viewport-overlay/view';

export function getInternalViewExtensions() {
  return [
    FoundationViewExtension,

    // Block
    AttachmentViewExtension,
    BookmarkViewExtension,
    CalloutViewExtension,
    CodeBlockViewExtension,
    DataViewViewExtension,
    DatabaseViewExtension,
    DividerViewExtension,
    EmbedViewExtension,
    EmbedDocViewExtension,
    FrameViewExtension,
    ImageViewExtension,
    LatexViewExtension,
    ListViewExtension,
    NoteViewExtension,
    ParagraphViewExtension,
    SurfaceRefViewExtension,
    TableViewExtension,
    SurfaceViewExtension,
    RootViewExtension,

    // Inline
    InlineCommentViewExtension,
    FootnoteViewExtension,
    LinkViewExtension,
    ReferenceViewExtension,
    InlineLatexViewExtension,
    MentionViewExtension,
    InlinePresetViewExtension,

    // Widget
    // order will affect the z-index of the widget
    DragHandleViewExtension,
    FrameTitleViewExtension,
    KeyboardToolbarViewExtension,
    LinkedDocViewExtension,
    RemoteSelectionViewExtension,
    ScrollAnchoringViewExtension,
    SlashMenuViewExtension,
    ToolbarViewExtension,
    ViewportOverlayViewExtension,
    PageDraggingAreaViewExtension,
    NoteSlicerViewExtension,

    // Fragment
    DocTitleViewExtension,
    FramePanelViewExtension,
    OutlineViewExtension,
    AdapterPanelViewExtension,
  ];
}

import { AttachmentStoreExtension } from '@blocksuite/notesgraph-block-attachment/store';
import { BookmarkStoreExtension } from '@blocksuite/notesgraph-block-bookmark/store';
import { CalloutStoreExtension } from '@blocksuite/notesgraph-block-callout/store';
import { CodeStoreExtension } from '@blocksuite/notesgraph-block-code/store';
import { DataViewStoreExtension } from '@blocksuite/notesgraph-block-data-view/store';
import { DatabaseStoreExtension } from '@blocksuite/notesgraph-block-database/store';
import { DividerStoreExtension } from '@blocksuite/notesgraph-block-divider/store';
import { EdgelessTextStoreExtension } from '@blocksuite/notesgraph-block-edgeless-text/store';
import { EmbedStoreExtension } from '@blocksuite/notesgraph-block-embed/store';
import { EmbedDocStoreExtension } from '@blocksuite/notesgraph-block-embed-doc/store';
import { FrameStoreExtension } from '@blocksuite/notesgraph-block-frame/store';
import { ImageStoreExtension } from '@blocksuite/notesgraph-block-image/store';
import { LatexStoreExtension } from '@blocksuite/notesgraph-block-latex/store';
import { ListStoreExtension } from '@blocksuite/notesgraph-block-list/store';
import { NoteStoreExtension } from '@blocksuite/notesgraph-block-note/store';
import { ParagraphStoreExtension } from '@blocksuite/notesgraph-block-paragraph/store';
import { RootStoreExtension } from '@blocksuite/notesgraph-block-root/store';
import { SurfaceStoreExtension } from '@blocksuite/notesgraph-block-surface/store';
import { SurfaceRefStoreExtension } from '@blocksuite/notesgraph-block-surface-ref/store';
import { TableStoreExtension } from '@blocksuite/notesgraph-block-table/store';
import { FoundationStoreExtension } from '@blocksuite/notesgraph-foundation/store';
import { BrushStoreExtension } from '@blocksuite/notesgraph-gfx-brush/store';
import { ConnectorStoreExtension } from '@blocksuite/notesgraph-gfx-connector/store';
import { GroupStoreExtension } from '@blocksuite/notesgraph-gfx-group/store';
import { MindmapStoreExtension } from '@blocksuite/notesgraph-gfx-mindmap/store';
import { ShapeStoreExtension } from '@blocksuite/notesgraph-gfx-shape/store';
import { TextStoreExtension } from '@blocksuite/notesgraph-gfx-text/store';
import { FootnoteStoreExtension } from '@blocksuite/notesgraph-inline-footnote/store';
import { LatexStoreExtension as InlineLatexStoreExtension } from '@blocksuite/notesgraph-inline-latex/store';
import { LinkStoreExtension } from '@blocksuite/notesgraph-inline-link/store';
import { InlinePresetStoreExtension } from '@blocksuite/notesgraph-inline-preset/store';
import { ReferenceStoreExtension } from '@blocksuite/notesgraph-inline-reference/store';

export function getInternalStoreExtensions() {
  return [
    FoundationStoreExtension,

    AttachmentStoreExtension,
    BookmarkStoreExtension,
    CalloutStoreExtension,
    CodeStoreExtension,
    DataViewStoreExtension,
    DatabaseStoreExtension,
    DividerStoreExtension,
    EdgelessTextStoreExtension,
    EmbedStoreExtension,
    EmbedDocStoreExtension,
    FrameStoreExtension,
    ImageStoreExtension,
    LatexStoreExtension,
    ListStoreExtension,
    NoteStoreExtension,
    ParagraphStoreExtension,
    SurfaceRefStoreExtension,
    TableStoreExtension,
    SurfaceStoreExtension,
    RootStoreExtension,

    FootnoteStoreExtension,
    LinkStoreExtension,
    ReferenceStoreExtension,
    InlineLatexStoreExtension,
    InlinePresetStoreExtension,

    BrushStoreExtension,
    ShapeStoreExtension,
    MindmapStoreExtension,
    ConnectorStoreExtension,
    GroupStoreExtension,
    TextStoreExtension,
  ];
}

import { ImageLayoutPainterExtension } from '@blocksuite/notesgraph-block-image/turbo-painter';
import { ListLayoutPainterExtension } from '@blocksuite/notesgraph-block-list/turbo-painter';
import { NoteLayoutPainterExtension } from '@blocksuite/notesgraph-block-note/turbo-painter';
import { ParagraphLayoutPainterExtension } from '@blocksuite/notesgraph-block-paragraph/turbo-painter';
import { ViewportLayoutPainter } from '@blocksuite/notesgraph-gfx-turbo-renderer/painter';

new ViewportLayoutPainter([
  ParagraphLayoutPainterExtension,
  ListLayoutPainterExtension,
  NoteLayoutPainterExtension,
  ImageLayoutPainterExtension,
]);

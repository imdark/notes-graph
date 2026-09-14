import { CodeLayoutPainterExtension } from '@blocksuite/notesgraph/blocks/code';
import { ImageLayoutPainterExtension } from '@blocksuite/notesgraph/blocks/image';
import { ListLayoutPainterExtension } from '@blocksuite/notesgraph/blocks/list';
import { NoteLayoutPainterExtension } from '@blocksuite/notesgraph/blocks/note';
import { ParagraphLayoutPainterExtension } from '@blocksuite/notesgraph/blocks/paragraph';
import { ViewportLayoutPainter } from '@blocksuite/notesgraph/gfx/turbo-renderer';

new ViewportLayoutPainter([
  ParagraphLayoutPainterExtension,
  ListLayoutPainterExtension,
  NoteLayoutPainterExtension,
  CodeLayoutPainterExtension,
  ImageLayoutPainterExtension,
]);

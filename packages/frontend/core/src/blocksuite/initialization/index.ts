import {
  NoteDisplayMode,
  type NoteProps,
  type ParagraphProps,
  type RootBlockProps,
} from '@blocksuite/notesgraph/model';
import type { SurfaceBlockProps } from '@blocksuite/notesgraph/std/gfx';
import { type Store, Text } from '@blocksuite/notesgraph/store';
import type { DocCreateOptions } from '@notesgraph/core/modules/doc/types';

export interface DocProps {
  page?: Partial<RootBlockProps>;
  surface?: Partial<SurfaceBlockProps>;
  note?: Partial<NoteProps>;
  paragraph?: Partial<ParagraphProps>;
  onStoreLoad?: (
    doc: Store,
    props: {
      noteId: string;
      paragraphId: string;
      surfaceId: string;
    }
  ) => void;
}

export function initDocFromProps(
  doc: Store,
  props?: DocProps,
  options: DocCreateOptions = {}
) {
  doc.load(() => {
    const pageBlockId = doc.addBlock(
      'notesgraph:page',
      props?.page || { title: new Text(options.title || '') }
    );
    const surfaceId = doc.addBlock(
      'notesgraph:surface' as never,
      props?.surface || {},
      pageBlockId
    );
    const noteBlockId = doc.addBlock(
      'notesgraph:note',
      {
        ...props?.note,
        displayMode: NoteDisplayMode.DocAndEdgeless,
      },
      pageBlockId
    );
    const paragraphBlockId = doc.addBlock(
      'notesgraph:paragraph',
      props?.paragraph || {},
      noteBlockId
    );
    props?.onStoreLoad?.(doc, {
      noteId: noteBlockId,
      paragraphId: paragraphBlockId,
      surfaceId,
    });
    doc.history.undoManager.clear();
  });
}

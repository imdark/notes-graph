import type {
  EdgelessRootBlockComponent,
  PageRootBlockComponent,
} from '@blocksuite/notesgraph/blocks/root';
import type { SurfaceBlockComponent } from '@blocksuite/notesgraph/blocks/surface';
import type { Store } from '@blocksuite/store';

import type { TestNotesGraphEditorContainer } from '../../index.js';

export function getSurface(doc: Store, editor: TestNotesGraphEditorContainer) {
  const surfaceModel = doc.getModelsByFlavour('notesgraph:surface');

  return editor.host!.view.getBlock(
    surfaceModel[0]!.id
  ) as SurfaceBlockComponent;
}

export function getDocRootBlock(
  doc: Store,
  editor: TestNotesGraphEditorContainer,
  mode: 'page'
): PageRootBlockComponent;
export function getDocRootBlock(
  doc: Store,
  editor: TestNotesGraphEditorContainer,
  mode: 'edgeless'
): EdgelessRootBlockComponent;
export function getDocRootBlock(
  doc: Store,
  editor: TestNotesGraphEditorContainer,
  _?: 'edgeless' | 'page'
) {
  return editor.host!.view.getBlock(doc.root!.id) as
    | EdgelessRootBlockComponent
    | PageRootBlockComponent;
}

export function addNote(doc: Store, props: Record<string, any> = {}) {
  const noteId = doc.addBlock(
    'notesgraph:note',
    {
      xywh: '[0, 0, 800, 100]',
      ...props,
    },
    doc.root
  );

  doc.addBlock('notesgraph:paragraph', {}, noteId);

  return noteId;
}

import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/notesgraph-ext-loader';

import { effects } from './effects';
import { noteSlicerWidget } from './note-slicer';

export class NoteSlicerViewExtension extends ViewExtensionProvider {
  override name = 'notesgraph-note-slicer-widget';

  override effect() {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    if (this.isEdgeless(context.scope)) {
      context.register(noteSlicerWidget);
    }
  }
}

import { NotesGraphAddBlockWidget } from './components/add-block-widget';
import {
  EDGELESS_DND_PREVIEW_ELEMENT,
  EdgelessDndPreviewElement,
} from './components/edgeless-preview/preview';
import {
  NOTESGRAPH_ADD_BLOCK_WIDGET,
  NOTESGRAPH_DRAG_HANDLE_WIDGET,
} from './consts';
import { NotesGraphDragHandleWidget } from './drag-handle';

export function effects() {
  customElements.define(
    NOTESGRAPH_DRAG_HANDLE_WIDGET,
    NotesGraphDragHandleWidget
  );
  customElements.define(NOTESGRAPH_ADD_BLOCK_WIDGET, NotesGraphAddBlockWidget);
  customElements.define(
    EDGELESS_DND_PREVIEW_ELEMENT,
    EdgelessDndPreviewElement
  );
}

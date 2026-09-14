import { EdgelessFrameTitleEditor } from './edgeless-frame-title-editor.js';
import { NOTESGRAPH_FRAME_TITLE, NotesGraphFrameTitle } from './frame-title.js';
import {
  NOTESGRAPH_FRAME_TITLE_WIDGET,
  NotesGraphFrameTitleWidget,
} from './notesgraph-frame-title-widget.js';

export function effects() {
  customElements.define(
    NOTESGRAPH_FRAME_TITLE_WIDGET,
    NotesGraphFrameTitleWidget
  );
  customElements.define(NOTESGRAPH_FRAME_TITLE, NotesGraphFrameTitle);
  customElements.define(
    'edgeless-frame-title-editor',
    EdgelessFrameTitleEditor
  );
}

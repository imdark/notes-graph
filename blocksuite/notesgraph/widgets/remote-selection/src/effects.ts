import { NOTESGRAPH_DOC_REMOTE_SELECTION_WIDGET } from './doc';
import { NotesGraphDocRemoteSelectionWidget } from './doc/doc-remote-selection';
import {
  EdgelessRemoteSelectionWidget,
  NOTESGRAPH_EDGELESS_REMOTE_SELECTION_WIDGET,
} from './edgeless';

export function effects() {
  customElements.define(
    NOTESGRAPH_DOC_REMOTE_SELECTION_WIDGET,
    NotesGraphDocRemoteSelectionWidget
  );
  customElements.define(
    NOTESGRAPH_EDGELESS_REMOTE_SELECTION_WIDGET,
    EdgelessRemoteSelectionWidget
  );
}

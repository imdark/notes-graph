import {
  NOTESGRAPH_VIEWPORT_OVERLAY_WIDGET,
  NotesGraphViewportOverlayWidget,
} from './index';

export function effects() {
  customElements.define(
    NOTESGRAPH_VIEWPORT_OVERLAY_WIDGET,
    NotesGraphViewportOverlayWidget
  );
}

import {
  NOTESGRAPH_PAGE_DRAGGING_AREA_WIDGET,
  NotesGraphPageDraggingAreaWidget,
} from './index';

export function effects() {
  customElements.define(
    NOTESGRAPH_PAGE_DRAGGING_AREA_WIDGET,
    NotesGraphPageDraggingAreaWidget
  );
}

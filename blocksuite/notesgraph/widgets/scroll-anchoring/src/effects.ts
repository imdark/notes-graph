import {
  NOTESGRAPH_SCROLL_ANCHORING_WIDGET,
  NotesGraphScrollAnchoringWidget,
} from './scroll-anchoring.js';

export function effects() {
  customElements.define(
    NOTESGRAPH_SCROLL_ANCHORING_WIDGET,
    NotesGraphScrollAnchoringWidget
  );
}

declare global {
  interface HTMLElementTagNameMap {
    [NOTESGRAPH_SCROLL_ANCHORING_WIDGET]: NotesGraphScrollAnchoringWidget;
  }
}

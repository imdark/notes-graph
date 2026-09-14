import { NOTESGRAPH_TOOLBAR_WIDGET, NotesGraphToolbarWidget } from './toolbar';

export function effects() {
  customElements.define(NOTESGRAPH_TOOLBAR_WIDGET, NotesGraphToolbarWidget);
}

declare global {
  interface HTMLElementTagNameMap {
    [NOTESGRAPH_TOOLBAR_WIDGET]: NotesGraphToolbarWidget;
  }
}

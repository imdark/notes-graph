import { NotesGraphReference, ReferencePopup } from './reference-node';

export function effects() {
  customElements.define('reference-popup', ReferencePopup);
  customElements.define('notesgraph-reference', NotesGraphReference);
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-reference': NotesGraphReference;
    'reference-popup': ReferencePopup;
  }
}

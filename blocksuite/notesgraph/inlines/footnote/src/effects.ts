import { NotesGraphFootnoteNode } from './footnote-node/footnote-node';
import { FootNotePopup } from './footnote-node/footnote-popup';
import { FootNotePopupChip } from './footnote-node/footnote-popup-chip';

export function effects() {
  customElements.define('notesgraph-footnote-node', NotesGraphFootnoteNode);
  customElements.define('footnote-popup', FootNotePopup);
  customElements.define('footnote-popup-chip', FootNotePopupChip);
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-footnote-node': NotesGraphFootnoteNode;
    'footnote-popup': FootNotePopup;
    'footnote-popup-chip': FootNotePopupChip;
  }
}

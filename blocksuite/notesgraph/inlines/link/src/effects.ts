import { LinkPopup } from './link-node/link-popup/link-popup';
import { NotesGraphLink } from './link-node/notesgraph-link';

export function effects() {
  customElements.define('link-popup', LinkPopup);
  customElements.define('notesgraph-link', NotesGraphLink);
}

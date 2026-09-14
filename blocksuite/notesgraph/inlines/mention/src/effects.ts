import { NotesGraphMention } from './notesgraph-mention';

export function effects() {
  customElements.define('notesgraph-mention', NotesGraphMention);
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-mention': NotesGraphMention;
  }
}

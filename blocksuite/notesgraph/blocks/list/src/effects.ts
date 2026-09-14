import { ListBlockComponent } from './list-block.js';

export function effects() {
  customElements.define('notesgraph-list', ListBlockComponent);
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-list': ListBlockComponent;
  }
}

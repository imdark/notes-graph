import { ListViewUI } from './view.js';

export function pcEffects() {
  if (customElements.get('notesgraph-data-view-list')) {
    return;
  }
  customElements.define('notesgraph-data-view-list', ListViewUI);
}

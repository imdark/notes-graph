import { ChartViewUI } from './view.js';

export function pcEffects() {
  if (customElements.get('notesgraph-data-view-chart')) {
    return;
  }
  customElements.define('notesgraph-data-view-chart', ChartViewUI);
}

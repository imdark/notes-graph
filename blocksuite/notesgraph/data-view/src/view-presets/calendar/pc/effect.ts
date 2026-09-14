import { CalendarViewUI } from './view.js';

export function pcEffects() {
  if (customElements.get('notesgraph-data-view-calendar')) {
    return;
  }
  customElements.define('notesgraph-data-view-calendar', CalendarViewUI);
}

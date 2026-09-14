import { GanttViewUI } from './pc/view.js';

export function ganttEffects() {
  if (customElements.get('notesgraph-data-view-gantt')) {
    return;
  }
  customElements.define('notesgraph-data-view-gantt', GanttViewUI);
}

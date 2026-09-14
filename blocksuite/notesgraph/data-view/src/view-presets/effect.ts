import { calendarEffects } from './calendar/effect.js';
import { ganttEffects } from './gantt/effect.js';
import { kanbanEffects } from './kanban/effect.js';
import { listEffects } from './list/effect.js';
import { tableEffects } from './table/effect.js';

export function viewPresetsEffects() {
  calendarEffects();
  ganttEffects();
  kanbanEffects();
  listEffects();
  tableEffects();
}

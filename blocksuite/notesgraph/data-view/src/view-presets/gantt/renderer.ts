import './effect.js';

import { createIcon } from '../../core/utils/uni-icon.js';
import type { DataViewUILogicBaseConstructor } from '../../core/view/data-view-base.js';
import { ganttViewModel } from './define.js';
import { GanttViewUILogic } from './pc/view.js';

export const ganttViewMeta = ganttViewModel.createMeta({
  icon: createIcon('TimelineIcon'),
  pcLogic: () => GanttViewUILogic as unknown as DataViewUILogicBaseConstructor,
});

import './pc/effect.js';

import { createIcon } from '../../core/utils/uni-icon.js';
import type { DataViewUILogicBaseConstructor } from '../../core/view/data-view-base.js';
import { chartViewModel } from './define.js';
import { ChartViewUILogic } from './pc/view.js';

export const chartViewMeta = chartViewModel.createMeta({
  icon: createIcon('ChartPanelIcon'),
  pcLogic: () => ChartViewUILogic as unknown as DataViewUILogicBaseConstructor,
});

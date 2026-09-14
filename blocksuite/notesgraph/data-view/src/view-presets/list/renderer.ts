import './pc/effect.js';

import { createIcon } from '../../core/utils/uni-icon.js';
import type { DataViewUILogicBaseConstructor } from '../../core/view/data-view-base.js';
import { listViewModel } from './define.js';
import { ListViewUILogic } from './pc/view.js';

export const listViewMeta = listViewModel.createMeta({
  icon: createIcon('CheckBoxCheckLinearIcon'),
  pcLogic: () =>
    ListViewUILogic as unknown as DataViewUILogicBaseConstructor,
});

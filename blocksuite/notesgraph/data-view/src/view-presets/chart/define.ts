import { viewType } from '../../core/view/data-view.js';
import { ChartSingleView } from './chart-view-manager.js';
import type { ChartViewData } from './types.js';

export const chartViewType = viewType('chart');

/** Group-by columns tried in order for a new chart: a status lane beats a date. */
const DEFAULT_GROUP_TYPES = ['select', 'multi-select', 'checkbox', 'date'];

export const chartViewModel = chartViewType.createModel<ChartViewData>({
  defaultName: 'Chart',
  dataViewManager: ChartSingleView,
  defaultData: viewManager => {
    const dataSource = viewManager.dataSource;
    const properties = dataSource.properties$.value;
    let groupBy: string | undefined;
    for (const type of DEFAULT_GROUP_TYPES) {
      groupBy = properties.find(id => dataSource.propertyTypeGet(id) === type);
      if (groupBy) break;
    }
    const groupType = groupBy ? dataSource.propertyTypeGet(groupBy) : undefined;
    return {
      filter: {
        type: 'group',
        op: 'and',
        conditions: [],
      },
      chart: {
        // Over time reads as a line; anything else as bars.
        kind: groupType === 'date' ? 'line' : 'bar',
        groupBy,
        dateBucket: 'week',
        metric: { op: 'count' },
      },
    };
  },
});

import { viewType } from '../../core/view/data-view.js';
import { GanttSingleView } from './gantt-view-manager.js';
import type { GanttViewData } from './types.js';

export const ganttViewType = viewType('gantt');

export const ganttViewModel = ganttViewType.createModel<GanttViewData>({
  defaultName: 'Gantt View',
  dataViewManager: GanttSingleView,
  defaultData: viewManager => {
    const properties = viewManager.dataSource.properties$.value;
    const firstDate = properties.find(
      id => viewManager.dataSource.propertyTypeGet(id) === 'date'
    );
    const firstRelation = properties.find(
      id => viewManager.dataSource.propertyTypeGet(id) === 'relation'
    );
    return {
      filter: {
        type: 'group',
        op: 'and',
        conditions: [],
      },
      date: {
        startColumnId: firstDate,
      },
      dependsOn: {
        columnId: firstRelation,
      },
      card: {
        titleColumnId: properties.find(
          id => viewManager.dataSource.propertyTypeGet(id) === 'title'
        ),
      },
      ui: {
        zoom: 'day',
      },
    };
  },
});

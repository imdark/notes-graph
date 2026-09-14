import { viewType } from '../../core/view/data-view.js';
import { ListSingleView } from './list-view-manager.js';
import type { ListViewData } from './types.js';

export const listViewType = viewType('list');

export const listViewModel = listViewType.createModel<ListViewData>({
  defaultName: 'List View',
  dataViewManager: ListSingleView,
  defaultData: viewManager => {
    return {
      filter: {
        type: 'group',
        op: 'and',
        conditions: [],
      },
      header: {
        titleColumn: viewManager.dataSource.properties$.value.find(
          id => viewManager.dataSource.propertyTypeGet(id) === 'title'
        ),
      },
    };
  },
});

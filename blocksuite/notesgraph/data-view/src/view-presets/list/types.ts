import type { FilterGroup } from '../../core/filter/types.js';
import type { Sort } from '../../core/sort/types.js';
import type { BasicViewDataType } from '../../core/view/data-view.js';

type ListViewDataShape = {
  filter: FilterGroup;
  sort?: Sort;
  header?: {
    titleColumn?: string;
  };
  // How many rows to show per page in the list view (configurable; defaults to
  // DEFAULT_LIST_PAGE_SIZE when unset).
  pageSize?: number;
};

export type ListViewData = BasicViewDataType<'list', ListViewDataShape>;

export type ListStoredViewData = ListViewData;

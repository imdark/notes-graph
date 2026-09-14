import type { InsertToPosition } from '@blocksuite/notesgraph-shared/utils';
import { computed } from '@preact/signals-core';

import { evalFilter } from '../../core/filter/eval.js';
import { FilterTrait, filterTraitKey } from '../../core/filter/trait.js';
import type { FilterGroup } from '../../core/filter/types.js';
import { emptyFilterGroup } from '../../core/filter/utils.js';
import { SortManager, sortTraitKey } from '../../core/sort/manager.js';
import { PropertyBase } from '../../core/view-manager/property.js';
import { type Row, RowBase } from '../../core/view-manager/row.js';
import {
  type SingleView,
  SingleViewBase,
} from '../../core/view-manager/single-view.js';
import type { ViewManager } from '../../core/view-manager/view-manager.js';
import type { ListStoredViewData } from './types.js';

// Default rows-per-page for the list view; overridable per view via pageSize.
export const DEFAULT_LIST_PAGE_SIZE = 8;
// Options offered by the page-size picker in the list footer.
export const LIST_PAGE_SIZE_OPTIONS = [8, 15, 25, 50, 100];

/**
 * A read-only list view: rows are the data source's rows, narrowed by the
 * generic data-view filter and ordered by the generic sort. Search and the
 * filter/sort bar come from the shared view tools (keyed on view type in the
 * database block). Everything column/group/stat-related that the table view
 * carries is intentionally dropped — a list is one column (the title) deep.
 */
export class ListSingleView extends SingleViewBase<ListStoredViewData> {
  propertiesRaw$ = computed(() => {
    return this.dataSource.properties$.value.map(id =>
      this.propertyGetOrCreate(id)
    );
  });

  properties$ = this.propertiesRaw$;

  detailProperties$ = computed(() => {
    return this.propertiesRaw$.value.filter(
      property => property.type$.value !== 'title'
    );
  });

  private readonly filter$ = computed(() => {
    return this.data$.value?.filter ?? emptyFilterGroup;
  });

  private readonly sortList$ = computed(() => {
    return this.data$.value?.sort;
  });

  private readonly sortManager = this.traitSet(
    sortTraitKey,
    new SortManager(this.sortList$, this, {
      setSortList: sortList => {
        this.dataUpdate(data => ({
          sort: {
            ...data.sort,
            ...sortList,
          },
        }));
      },
    })
  );

  filterTrait = this.traitSet(
    filterTraitKey,
    new FilterTrait(this.filter$, this, {
      filterSet: (filter: FilterGroup) => {
        this.dataUpdate(() => ({ filter }));
      },
    })
  );

  mainProperties$ = computed(() => {
    return {
      titleColumn:
        this.data$.value?.header?.titleColumn ??
        this.propertiesRaw$.value.find(
          property => property.type$.value === 'title'
        )?.id,
    };
  });

  readonly$ = computed(() => {
    return this.manager.readonly$.value;
  });

  // Rows-per-page, persisted on the view. Guards against a corrupt/0 value.
  pageSize$ = computed(() => {
    const stored = this.data$.value?.pageSize;
    return stored && stored > 0 ? stored : DEFAULT_LIST_PAGE_SIZE;
  });

  pageSizeSet(pageSize: number): void {
    this.dataUpdate(() => ({ pageSize }));
  }

  get type(): string {
    return this.data$.value?.mode ?? 'list';
  }

  constructor(viewManager: ViewManager, viewId: string) {
    super(viewManager, viewId);
  }

  isShow(rowId: string): boolean {
    if (this.filter$.value?.conditions.length) {
      const rowMap = Object.fromEntries(
        this.propertiesRaw$.value.map(column => [
          column.id,
          column.cellGetOrCreate(rowId).jsonValue$.value,
        ])
      );
      return evalFilter(this.filter$.value, rowMap);
    }
    return true;
  }

  override rowsMapping(rows: Row[]) {
    return this.sortManager.sort(super.rowsMapping(rows));
  }

  propertyGetOrCreate(propertyId: string): ListProperty {
    return new ListProperty(this, propertyId);
  }

  override rowGetOrCreate(rowId: string): ListRow {
    return new ListRow(this, rowId);
  }
}

export class ListProperty extends PropertyBase {
  hide$ = computed(() => false);

  constructor(view: ListSingleView, propertyId: string) {
    super(view as SingleView, propertyId);
  }

  hideSet(_hide: boolean): void {}

  move(_position: InsertToPosition): void {}
}

export class ListRow extends RowBase {
  constructor(
    readonly listView: ListSingleView,
    rowId: string
  ) {
    super(listView, rowId);
  }
}

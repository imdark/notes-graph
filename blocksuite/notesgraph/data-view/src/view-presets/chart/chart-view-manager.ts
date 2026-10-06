import type { InsertToPosition } from '@blocksuite/notesgraph-shared/utils';
import { computed } from '@preact/signals-core';

import { evalFilter } from '../../core/filter/eval.js';
import { FilterTrait, filterTraitKey } from '../../core/filter/trait.js';
import type { FilterGroup } from '../../core/filter/types.js';
import { emptyFilterGroup } from '../../core/filter/utils.js';
import type { SelectTag } from '../../core/logical/type-presets.js';
import { PropertyBase } from '../../core/view-manager/property.js';
import { RowBase } from '../../core/view-manager/row.js';
import {
  type SingleView,
  SingleViewBase,
} from '../../core/view-manager/single-view.js';
import type { ViewManager } from '../../core/view-manager/view-manager.js';
import {
  aggregateRows,
  type ChartBucket,
  type ChartGroupKey,
  type ChartRowInput,
  dateGroup,
  emptyGroup,
} from './chart-data.js';
import type { ChartStoredViewData, ChartViewData } from './types.js';

/** Column types a chart can bucket rows by. */
export const CHART_GROUPABLE_TYPES = new Set([
  'select',
  'multi-select',
  'checkbox',
  'date',
  'title',
  'text',
  'number',
  'progress',
]);

/** Column types a chart can sum/average. */
export const CHART_NUMERIC_TYPES = new Set(['number', 'progress']);

type ChartSettings = ChartViewData['chart'];

const ALL_GROUP: ChartGroupKey = { key: 'all', label: 'All', order: 0 };

/**
 * A read-only view that aggregates the (filtered) rows into one series —
 * row counts or a number column's sum/average/min/max per value of a
 * "group by" column — and draws it as a bar, column, donut or line chart, or
 * as a single headline number. It reads cells through the same view manager
 * as every other view, so it works over a plain database and over a query
 * board's live task rows alike.
 */
export class ChartSingleView extends SingleViewBase<ChartStoredViewData> {
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

  mainProperties$ = computed(() => {
    return {
      titleColumn: this.propertiesRaw$.value.find(
        property => property.type$.value === 'title'
      )?.id,
    };
  });

  readonly$ = computed(() => {
    return this.manager.readonly$.value;
  });

  private readonly filter$ = computed(() => {
    return this.data$.value?.filter ?? emptyFilterGroup;
  });

  filterTrait = this.traitSet(
    filterTraitKey,
    new FilterTrait(this.filter$, this, {
      filterSet: (filter: FilterGroup) => {
        this.dataUpdate(() => ({ filter }));
      },
    })
  );

  settings$ = computed((): ChartSettings => {
    return this.data$.value?.chart ?? { kind: 'bar', metric: { op: 'count' } };
  });

  settingsUpdate(patch: Partial<ChartSettings>): void {
    this.dataUpdate(data => ({ chart: { ...data.chart, ...patch } }));
  }

  /** The group-by column, if it still exists and can be grouped by. */
  groupByProperty$ = computed(() => {
    const id = this.settings$.value.groupBy;
    if (!id) return undefined;
    return this.propertiesRaw$.value.find(
      property =>
        property.id === id && CHART_GROUPABLE_TYPES.has(property.type$.value)
    );
  });

  /** The metric column, when the metric needs one and it still exists. */
  metricProperty$ = computed(() => {
    const { metric } = this.settings$.value;
    if (metric.op === 'count' || !metric.propertyId) return undefined;
    return this.propertiesRaw$.value.find(
      property =>
        property.id === metric.propertyId &&
        CHART_NUMERIC_TYPES.has(property.type$.value)
    );
  });

  /**
   * The effective metric: a sum/avg whose number column was deleted falls
   * back to a row count rather than charting zeros.
   */
  metricOp$ = computed(() => {
    const op = this.settings$.value.metric.op;
    return op !== 'count' && !this.metricProperty$.value ? 'count' : op;
  });

  private groupKeysFor(rowId: string): ChartGroupKey[] {
    const property = this.groupByProperty$.value;
    if (!property) return [ALL_GROUP];
    const type = property.type$.value;
    const cell = property.cellGetOrCreate(rowId);
    const value = cell.value$.value as unknown;

    if (type === 'select' || type === 'multi-select') {
      const options =
        (property.data$.value as { options?: SelectTag[] }).options ?? [];
      const ids = (Array.isArray(value) ? value : [value]).filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      );
      const groups = ids.flatMap(id => {
        const index = options.findIndex(option => option.id === id);
        const option = options[index];
        if (!option) return [];
        return [
          {
            key: id,
            label: option.value || 'Untitled',
            order: index,
            colorIndex: index,
          },
        ];
      });
      return groups.length ? groups : [emptyGroup()];
    }

    if (type === 'checkbox') {
      return value
        ? [{ key: 'true', label: 'Checked', order: 0, colorIndex: 0 }]
        : [{ key: 'false', label: 'Unchecked', order: 1, colorIndex: 1 }];
    }

    if (type === 'date') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return [emptyGroup()];
      }
      return [dateGroup(value, this.settings$.value.dateBucket ?? 'day')];
    }

    if (type === 'number' || type === 'progress') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return [emptyGroup()];
      }
      return [{ key: String(value), label: String(value), order: value }];
    }

    const text = (cell.stringValue$.value ?? '').trim();
    if (!text) return [emptyGroup()];
    return [{ key: text, label: text, order: text.toLowerCase() }];
  }

  private measureFor(rowId: string): number | undefined {
    const property = this.metricProperty$.value;
    if (!property) return undefined;
    const value = property.cellGetOrCreate(rowId).value$.value;
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  /** The chart's one series, in display order. */
  buckets$ = computed((): ChartBucket[] => {
    const settings = this.settings$.value;
    const groupBy = this.groupByProperty$.value;
    const rows: ChartRowInput[] = this.rows$.value.map(row => ({
      groups: this.groupKeysFor(row.rowId),
      measure: this.measureFor(row.rowId),
    }));
    return aggregateRows(rows, this.metricOp$.value, {
      dateBucket:
        groupBy?.type$.value === 'date'
          ? (settings.dateBucket ?? 'day')
          : undefined,
      hideEmpty: settings.hideEmpty,
    });
  });

  /** The whole filtered set under the metric — the headline number. */
  total$ = computed((): number => {
    const rows: ChartRowInput[] = this.rows$.value.map(row => ({
      groups: [ALL_GROUP],
      measure: this.measureFor(row.rowId),
    }));
    return aggregateRows(rows, this.metricOp$.value)[0]?.value ?? 0;
  });

  /** "Count", "Sum of Points", … — names the value axis. */
  metricLabel$ = computed((): string => {
    const op = this.metricOp$.value;
    const property = this.metricProperty$.value;
    if (op === 'count' || !property) return 'Count';
    const opName = { sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max' }[op];
    return `${opName} of ${property.name$.value || 'Untitled'}`;
  });

  get type(): string {
    return this.data$.value?.mode ?? 'chart';
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

  propertyGetOrCreate(propertyId: string): ChartProperty {
    return new ChartProperty(this, propertyId);
  }

  override rowGetOrCreate(rowId: string): ChartRow {
    return new ChartRow(this, rowId);
  }
}

export class ChartProperty extends PropertyBase {
  hide$ = computed(() => false);

  constructor(view: ChartSingleView, propertyId: string) {
    super(view as SingleView, propertyId);
  }

  hideSet(_hide: boolean): void {}

  move(_position: InsertToPosition): void {}
}

export class ChartRow extends RowBase {
  constructor(
    readonly chartView: ChartSingleView,
    rowId: string
  ) {
    super(chartView, rowId);
  }
}

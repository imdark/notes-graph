import type { FilterGroup } from '../../core/filter/types.js';
import type { BasicViewDataType } from '../../core/view/data-view.js';

/**
 * - `bar`: horizontal bars, one per group — the default, labels never collide.
 * - `column`: vertical bars, for a handful of groups or a date axis.
 * - `donut`: parts of a whole.
 * - `line`: a value over time (group by a date column).
 * - `number`: a single headline figure — no grouping.
 */
export type ChartKind = 'bar' | 'column' | 'donut' | 'line' | 'number';

export type ChartMetricOp = 'count' | 'sum' | 'avg' | 'min' | 'max';

export type ChartDateBucket = 'day' | 'week' | 'month';

type ChartViewDataShape = {
  filter: FilterGroup;
  chart: {
    kind: ChartKind;
    /** The column rows are bucketed by. Unset: everything is one bucket. */
    groupBy?: string;
    /** Bucket width when `groupBy` is a date column. */
    dateBucket?: ChartDateBucket;
    metric: {
      op: ChartMetricOp;
      /** The number column summed/averaged; unused for `count`. */
      propertyId?: string;
    };
    /** Leave rows with no value for `groupBy` out instead of an "Empty" bucket. */
    hideEmpty?: boolean;
  };
};

export type ChartViewData = BasicViewDataType<'chart', ChartViewDataShape>;

export type ChartStoredViewData = ChartViewData;

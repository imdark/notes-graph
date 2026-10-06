import type { ChartDateBucket, ChartMetricOp } from './types.js';

/**
 * Turning rows into chart buckets, kept free of signals and the DOM so it can
 * be unit tested on plain values.
 */

/** One bucket a row lands in. A multi-select row lands in several. */
export type ChartGroupKey = {
  key: string;
  label: string;
  /**
   * Sort position. Select options keep their column order (so "Todo, In
   * Progress, Done" reads left to right), dates sort by time, anything else
   * falls back to the value itself.
   */
  order: number | string;
  /** Stable index for the bucket's colour — the option's position, never its rank. */
  colorIndex?: number;
};

export type ChartRowInput = {
  groups: ChartGroupKey[];
  /** The metric column's value; ignored by `count`. */
  measure?: number;
};

export type ChartBucket = {
  key: string;
  label: string;
  value: number;
  /** Rows that landed here, whatever the metric. */
  rows: number;
  colorIndex?: number;
};

export const EMPTY_GROUP_KEY = '__empty__';

export const emptyGroup = (): ChartGroupKey => ({
  key: EMPTY_GROUP_KEY,
  label: 'Empty',
  // After every real value.
  order: Number.POSITIVE_INFINITY,
});

/** The local-time start of the bucket `epochMs` falls in. Weeks start Monday. */
export const dateBucketStart = (
  epochMs: number,
  bucket: ChartDateBucket
): number => {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  if (bucket === 'week') {
    const offset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - offset);
  } else if (bucket === 'month') {
    date.setDate(1);
  }
  return date.getTime();
};

const nextBucketStart = (start: number, bucket: ChartDateBucket): number => {
  const date = new Date(start);
  if (bucket === 'month') {
    date.setMonth(date.getMonth() + 1);
  } else {
    date.setDate(date.getDate() + (bucket === 'week' ? 7 : 1));
  }
  return date.getTime();
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export const dateBucketLabel = (
  start: number,
  bucket: ChartDateBucket
): string => {
  const date = new Date(start);
  const month = MONTHS[date.getMonth()];
  if (bucket === 'month') {
    return `${month} ${date.getFullYear()}`;
  }
  return `${month} ${date.getDate()}`;
};

export const dateGroup = (
  epochMs: number,
  bucket: ChartDateBucket
): ChartGroupKey => {
  const start = dateBucketStart(epochMs, bucket);
  return {
    key: String(start),
    label: dateBucketLabel(start, bucket),
    order: start,
  };
};

/**
 * A line or column chart over time needs the quiet days too, or a gap reads
 * as a straight line between two busy ones. Capped so one stray date years
 * away can't produce thousands of empty buckets.
 */
const MAX_FILLED_DATE_BUCKETS = 400;

const fillDateGaps = (
  buckets: ChartBucket[],
  bucket: ChartDateBucket
): ChartBucket[] => {
  const dated = buckets.filter(b => b.key !== EMPTY_GROUP_KEY);
  const firstBucket = dated[0];
  const lastBucket = dated[dated.length - 1];
  if (!firstBucket || !lastBucket || dated.length < 2) return buckets;
  const byStart = new Map(dated.map(b => [Number(b.key), b]));
  const first = Number(firstBucket.key);
  const last = Number(lastBucket.key);
  const filled: ChartBucket[] = [];
  for (let start = first; start <= last; start = nextBucketStart(start, bucket)) {
    if (filled.length >= MAX_FILLED_DATE_BUCKETS) return buckets;
    filled.push(
      byStart.get(start) ?? {
        key: String(start),
        label: dateBucketLabel(start, bucket),
        value: 0,
        rows: 0,
      }
    );
  }
  const empty = buckets.find(b => b.key === EMPTY_GROUP_KEY);
  return empty ? [...filled, empty] : filled;
};

const compareOrder = (a: number | string, b: number | string): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return a.localeCompare(b, undefined, { numeric: true });
};

/** Combine the metric values that landed in one bucket. */
export const applyMetric = (op: ChartMetricOp, values: number[]): number => {
  if (op === 'count') return values.length;
  const numbers = values.filter(v => Number.isFinite(v));
  if (numbers.length === 0) return 0;
  switch (op) {
    case 'sum':
      return numbers.reduce((a, b) => a + b, 0);
    case 'avg':
      return numbers.reduce((a, b) => a + b, 0) / numbers.length;
    case 'min':
      return Math.min(...numbers);
    case 'max':
      return Math.max(...numbers);
  }
};

export const aggregateRows = (
  rows: ChartRowInput[],
  op: ChartMetricOp,
  options: { dateBucket?: ChartDateBucket; hideEmpty?: boolean } = {}
): ChartBucket[] => {
  const groups = new Map<
    string,
    { group: ChartGroupKey; values: number[]; rows: number }
  >();
  for (const row of rows) {
    for (const group of row.groups) {
      if (options.hideEmpty && group.key === EMPTY_GROUP_KEY) continue;
      let entry = groups.get(group.key);
      if (!entry) {
        entry = { group, values: [], rows: 0 };
        groups.set(group.key, entry);
      }
      entry.rows++;
      // `count` counts rows, so a row with no measure still counts.
      if (op === 'count') entry.values.push(1);
      else if (row.measure !== undefined) entry.values.push(row.measure);
    }
  }
  const buckets = [...groups.values()]
    .sort((a, b) => compareOrder(a.group.order, b.group.order))
    .map(({ group, values, rows }) => ({
      key: group.key,
      label: group.label,
      value: applyMetric(op, values),
      rows,
      colorIndex: group.colorIndex,
    }));
  return options.dateBucket
    ? fillDateGaps(buckets, options.dateBucket)
    : buckets;
};

/** Short, readable figures: 1234 → "1.2k", 0.333 → "0.33". */
export const formatChartValue = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${trim(value / 1e6, 1)}M`;
  if (abs >= 1e4) return `${trim(value / 1e3, 1)}k`;
  if (Number.isInteger(value)) return String(value);
  return trim(value, abs >= 100 ? 0 : 2);
};

const trim = (value: number, digits: number): string =>
  String(Number(value.toFixed(digits)));

/**
 * A "nice" axis maximum (1, 2, 2.5 or 5 × 10ⁿ) at or above `max`, so the
 * gridlines land on round numbers.
 */
export const niceAxisMax = (max: number): number => {
  if (max <= 0) return 1;
  const exponent = Math.floor(Math.log10(max));
  const base = 10 ** exponent;
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * base >= max) return step * base;
  }
  return 10 * base;
};

/** Slices past this fold into one "Other" slice — never a generated hue. */
export const MAX_DONUT_SLICES = 7;

export const foldDonutSlices = (buckets: ChartBucket[]): ChartBucket[] => {
  const positive = buckets.filter(b => b.value > 0);
  if (positive.length <= MAX_DONUT_SLICES) return positive;
  const sorted = [...positive].sort((a, b) => b.value - a.value);
  const kept = new Set(
    sorted.slice(0, MAX_DONUT_SLICES - 1).map(b => b.key)
  );
  const rest = positive.filter(b => !kept.has(b.key));
  return [
    ...positive.filter(b => kept.has(b.key)),
    {
      key: '__other__',
      label: `Other (${rest.length})`,
      value: rest.reduce((sum, b) => sum + b.value, 0),
      rows: rest.reduce((sum, b) => sum + b.rows, 0),
    },
  ];
};

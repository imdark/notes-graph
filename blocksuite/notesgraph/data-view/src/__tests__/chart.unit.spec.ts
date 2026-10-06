import { describe, expect, test } from 'vitest';

import {
  aggregateRows,
  type ChartGroupKey,
  dateBucketStart,
  dateGroup,
  EMPTY_GROUP_KEY,
  emptyGroup,
  foldDonutSlices,
  formatChartValue,
  MAX_DONUT_SLICES,
  niceAxisMax,
} from '../view-presets/chart/chart-data.js';

const option = (key: string, index: number): ChartGroupKey => ({
  key,
  label: key,
  order: index,
  colorIndex: index,
});

describe('chart aggregation', () => {
  test('counts rows per group in option order, empty last', () => {
    const todo = option('Todo', 0);
    const doing = option('In Progress', 1);
    const done = option('Done', 2);
    const buckets = aggregateRows(
      [
        { groups: [done] },
        { groups: [todo] },
        { groups: [emptyGroup()] },
        { groups: [done] },
        { groups: [doing] },
      ],
      'count'
    );
    expect(buckets.map(b => [b.label, b.value])).toEqual([
      ['Todo', 1],
      ['In Progress', 1],
      ['Done', 2],
      ['Empty', 1],
    ]);
  });

  test('hideEmpty drops rows with no value', () => {
    const buckets = aggregateRows(
      [{ groups: [option('a', 0)] }, { groups: [emptyGroup()] }],
      'count',
      { hideEmpty: true }
    );
    expect(buckets.map(b => b.key)).toEqual(['a']);
  });

  test('a multi-select row counts toward each of its options', () => {
    const buckets = aggregateRows(
      [
        { groups: [option('x', 0), option('y', 1)] },
        { groups: [option('y', 1)] },
      ],
      'count'
    );
    expect(buckets.map(b => [b.key, b.value])).toEqual([
      ['x', 1],
      ['y', 2],
    ]);
  });

  test('sum / avg / min / max skip rows without a number', () => {
    const g = option('g', 0);
    const rows = [
      { groups: [g], measure: 2 },
      { groups: [g], measure: 6 },
      { groups: [g] },
    ];
    expect(aggregateRows(rows, 'sum')[0]).toMatchObject({ value: 8, rows: 3 });
    expect(aggregateRows(rows, 'avg')[0]?.value).toBe(4);
    expect(aggregateRows(rows, 'min')[0]?.value).toBe(2);
    expect(aggregateRows(rows, 'max')[0]?.value).toBe(6);
    expect(aggregateRows([{ groups: [g] }], 'avg')[0]?.value).toBe(0);
  });

  test('date buckets fill the quiet days between busy ones', () => {
    const day1 = new Date(2026, 9, 1, 15).getTime();
    const day4 = new Date(2026, 9, 4, 9).getTime();
    const buckets = aggregateRows(
      [
        { groups: [dateGroup(day1, 'day')] },
        { groups: [dateGroup(day4, 'day')] },
        { groups: [dateGroup(day4, 'day')] },
      ],
      'count',
      { dateBucket: 'day' }
    );
    expect(buckets.map(b => [b.label, b.value])).toEqual([
      ['Oct 1', 1],
      ['Oct 2', 0],
      ['Oct 3', 0],
      ['Oct 4', 2],
    ]);
  });

  test('weeks start on Monday and months on the 1st', () => {
    // Sunday 2026-10-04 belongs to the week of Monday 2026-09-28.
    const sunday = new Date(2026, 9, 4, 12).getTime();
    expect(new Date(dateBucketStart(sunday, 'week')).getDate()).toBe(28);
    const monthStart = new Date(dateBucketStart(sunday, 'month'));
    expect([monthStart.getMonth(), monthStart.getDate()]).toEqual([9, 1]);
    expect(dateGroup(sunday, 'month').label).toBe('Oct 2026');
  });

  test('empty group keeps its reserved key', () => {
    expect(emptyGroup().key).toBe(EMPTY_GROUP_KEY);
  });
});

describe('chart formatting', () => {
  test('niceAxisMax rounds up to 1/2/2.5/5 × 10ⁿ', () => {
    expect(niceAxisMax(0)).toBe(1);
    expect(niceAxisMax(7)).toBe(10);
    expect(niceAxisMax(18)).toBe(20);
    expect(niceAxisMax(21)).toBe(25);
    expect(niceAxisMax(420)).toBe(500);
  });

  test('formatChartValue keeps figures short', () => {
    expect(formatChartValue(12)).toBe('12');
    expect(formatChartValue(1 / 3)).toBe('0.33');
    expect(formatChartValue(12345)).toBe('12.3k');
    expect(formatChartValue(2_500_000)).toBe('2.5M');
  });

  test('donut folds the smallest slices into Other', () => {
    const buckets = Array.from({ length: MAX_DONUT_SLICES + 3 }, (_, i) => ({
      key: `k${i}`,
      label: `k${i}`,
      value: i + 1,
      rows: 1,
    }));
    const slices = foldDonutSlices([
      ...buckets,
      { key: 'zero', label: 'zero', value: 0, rows: 0 },
    ]);
    expect(slices).toHaveLength(MAX_DONUT_SLICES);
    const other = slices[slices.length - 1];
    expect(other?.key).toBe('__other__');
    // k0..k3 (values 1..4) are the four smallest of the ten.
    expect(other?.value).toBe(1 + 2 + 3 + 4);
    expect(slices.reduce((s, b) => s + b.value, 0)).toBe(55);
  });
});

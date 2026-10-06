import { describe, expect, test } from 'vitest';

import {
  chartSeries,
  countTaskStatuses,
  parseReadingValue,
  valueDomain,
} from './chart-data';

describe('parseReadingValue', () => {
  test('takes the first number out of a monitor value', () => {
    expect(parseReadingValue('$1,234.50')).toBe(1234.5);
    expect(parseReadingValue('72°F')).toBe(72);
    expect(parseReadingValue('-3.2%')).toBe(-3.2);
    expect(parseReadingValue('3 open, 2 closed')).toBe(3);
    expect(parseReadingValue('.5')).toBe(0.5);
  });

  test('is null when there is no number', () => {
    expect(parseReadingValue('in stock')).toBeNull();
    expect(parseReadingValue('')).toBeNull();
    expect(parseReadingValue(null)).toBeNull();
  });
});

describe('chartSeries', () => {
  test('keeps the latest numeric readings, oldest first', () => {
    const readings = [
      { value: '30', at: 3 },
      { value: 'error page', at: 4 },
      { value: '10', at: 1 },
      { value: null, at: 5 },
      { value: '20', at: 2 },
    ];
    expect(chartSeries(readings, 2)).toEqual([
      { at: 2, value: 20 },
      { at: 3, value: 30 },
    ]);
  });
});

describe('valueDomain', () => {
  test('pads a flat series so it still has a height', () => {
    expect(valueDomain([{ at: 1, value: 5 }])).toEqual([4.5, 5.5]);
    expect(valueDomain([{ at: 1, value: 0 }])).toEqual([-1, 1]);
  });

  test('spans the lowest and highest value', () => {
    expect(
      valueDomain([
        { at: 1, value: 3 },
        { at: 2, value: -1 },
      ])
    ).toEqual([-1, 3]);
  });
});

describe('countTaskStatuses', () => {
  test('counts by status: todo and in progress first, done last', () => {
    expect(
      countTaskStatuses([
        '[X]',
        '[ ]',
        'QUEUED',
        'DONE',
        '[-]',
        '[ ]',
        'COMMITTED',
        'COMMITTED',
      ])
    ).toEqual([
      { label: 'Todo', count: 2 },
      { label: 'In Progress', count: 1 },
      { label: 'COMMITTED', count: 2 },
      { label: 'QUEUED', count: 1 },
      { label: 'Done', count: 2 },
    ]);
  });
});

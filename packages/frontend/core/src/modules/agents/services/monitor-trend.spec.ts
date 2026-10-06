import { describe, expect, test } from 'vitest';

import {
  formatTrendValue,
  monitorTrend,
  readingNumber,
  sparklinePath,
} from './monitor-trend';
import type { MonitorReading } from './monitors';

const reading = (
  value: string | null,
  at: number,
  error: string | null = null
): MonitorReading => ({ value, error, changed: false, alerted: false, at });

describe('readingNumber', () => {
  test('takes the first number out of a reading', () => {
    expect(readingNumber('0.92')).toBe(0.92);
    expect(readingNumber('RTX 5090 at $1,899 (Micro Center)')).toBe(5090);
    expect(readingNumber('$1,899')).toBe(1899);
    expect(readingNumber('-3.5 °C')).toBe(-3.5);
    expect(readingNumber('42%')).toBe(42);
  });

  test('is null when there is no number', () => {
    expect(readingNumber(null)).toBeNull();
    expect(readingNumber('')).toBeNull();
    expect(readingNumber('sold out')).toBeNull();
  });
});

describe('monitorTrend', () => {
  test('puts the server’s newest-first readings oldest first', () => {
    const trend = monitorTrend([reading('5', 30), reading('2', 20), reading('4', 10)]);
    expect(trend?.points.map(p => p.value)).toEqual([4, 2, 5]);
    expect(trend).toMatchObject({ min: 2, max: 5, latest: 5, delta: 1 });
  });

  test('leaves out failed checks and readings without a number', () => {
    const trend = monitorTrend([
      reading('3', 40),
      reading(null, 30, 'timeout'),
      reading('n/a', 20),
      reading('1', 10),
    ]);
    expect(trend?.points.map(p => p.at)).toEqual([10, 40]);
  });

  test('is null with fewer than two numbers', () => {
    expect(monitorTrend([])).toBeNull();
    expect(monitorTrend([reading('1', 10), reading('n/a', 20)])).toBeNull();
  });
});

describe('sparklinePath', () => {
  test('spans the width and puts the highest value at the top', () => {
    const trend = monitorTrend([reading('10', 20), reading('0', 10)])!;
    expect(sparklinePath(trend, 100, 20, 0)).toBe('M0.0,20.0 L100.0,0.0');
  });

  test('a flat series runs through the middle', () => {
    const trend = monitorTrend([reading('7', 20), reading('7', 10)])!;
    expect(sparklinePath(trend, 10, 10, 1)).toBe('M1.0,5.0 L9.0,5.0');
  });
});

describe('formatTrendValue', () => {
  test('keeps chip values short', () => {
    expect(formatTrendValue(12)).toBe('12');
    expect(formatTrendValue(0.9234)).toBe('0.923');
    expect(formatTrendValue(1899)).toBe('1899');
    expect(formatTrendValue(18990)).toBe('19k');
    expect(formatTrendValue(3_400_000)).toBe('3.4M');
  });
});

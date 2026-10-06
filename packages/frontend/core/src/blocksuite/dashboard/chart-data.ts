import { orgStatusLabel } from '@blocksuite/notesgraph/shared/utils';

/** One numeric reading of a monitor. `at` is epoch seconds. */
export interface ChartPoint {
  at: number;
  value: number;
}

const NUMBER_RE = /-?\d[\d,]*(?:\.\d+)?|-?\.\d+/;

/**
 * The number in a monitor's value: monitors store text ("$1,234.50",
 * "72°F", "3 open"), so take the first number in it, dropping thousands
 * separators. Null when there's none.
 */
export function parseReadingValue(value: string | null | undefined) {
  if (!value) return null;
  const match = NUMBER_RE.exec(value);
  if (!match) return null;
  const number = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

/** The latest `points` numeric readings, oldest first. */
export function chartSeries(
  readings: { value: string | null; at: number }[],
  points: number
): ChartPoint[] {
  const series: ChartPoint[] = [];
  for (const reading of readings) {
    const value = parseReadingValue(reading.value);
    if (value !== null) series.push({ at: reading.at, value });
  }
  series.sort((a, b) => a.at - b.at);
  return series.slice(-Math.max(1, points));
}

/** The low and high a chart's y axis spans, padded so a flat line shows. */
export function valueDomain(series: ChartPoint[]): [number, number] {
  if (series.length === 0) return [0, 1];
  let min = Math.min(...series.map(p => p.value));
  let max = Math.max(...series.map(p => p.value));
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  return [min, max];
}

/** A value for a label: compact for big numbers, a few decimals for small. */
export function formatValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10_000) {
    return new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: abs >= 100 ? 0 : abs >= 1 ? 2 : 4,
  }).format(value);
}

export interface StatusCount {
  label: string;
  count: number;
}

/** Statuses that come first and last; any other keyword sits between. */
const LEADING = ['Todo', 'In Progress'];
const TRAILING = ['Done'];

/**
 * Tasks counted by status, from each task's org status text (`[ ]`, `[-]`,
 * `DONE`, `QUEUED`…). Todo and In Progress lead, Done comes last, and other
 * keywords sit between them, most common first.
 */
export function countTaskStatuses(statusTexts: string[]): StatusCount[] {
  const counts = new Map<string, number>();
  for (const text of statusTexts) {
    const label = orgStatusLabel(text);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const rank = (label: string) =>
    LEADING.includes(label)
      ? LEADING.indexOf(label)
      : TRAILING.includes(label)
        ? 100 + TRAILING.indexOf(label)
        : 10;
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort(
      (a, b) =>
        rank(a.label) - rank(b.label) ||
        b.count - a.count ||
        a.label.localeCompare(b.label)
    );
}

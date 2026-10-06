import type { MonitorReading } from './monitors';

/**
 * A monitor's numeric readings over time, for the trend sparkline on its
 * block chip and its Agents page card. Readings whose value isn't a number
 * (text monitors, failed checks) are left out.
 */

export interface TrendPoint {
  /** Epoch seconds. */
  at: number;
  value: number;
}

export interface Trend {
  points: TrendPoint[];
  min: number;
  max: number;
  latest: number;
  /** The latest reading minus the first one shown. */
  delta: number;
}

/** The first number in a reading: "0.92", "$1,899", "-3.5 °C", "42%". */
export function readingNumber(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/-?\d[\d,]*(?:\.\d+)?|-?\.\d+/);
  if (!match) return null;
  const n = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Oldest-first numeric points from readings as the server lists them (newest
 * first). Null when there are fewer than two: nothing to draw a line through.
 */
export function monitorTrend(readings: MonitorReading[]): Trend | null {
  const points: TrendPoint[] = [];
  for (const reading of readings) {
    if (reading.error) continue;
    const value = readingNumber(reading.value);
    if (value !== null) points.push({ at: reading.at, value });
  }
  if (points.length < 2) return null;
  points.sort((a, b) => a.at - b.at);
  const values = points.map(p => p.value);
  const latest = values[values.length - 1];
  return {
    points,
    min: Math.min(...values),
    max: Math.max(...values),
    latest,
    delta: latest - values[0],
  };
}

/**
 * An SVG path through the points, spaced evenly across `width` and scaled to
 * fill `height` (a flat series sits in the middle). `pad` keeps the stroke
 * off the edges.
 */
export function sparklinePath(
  trend: Trend,
  width: number,
  height: number,
  pad = 1
): string {
  const { points, min, max } = trend;
  const span = max - min;
  const step = (width - pad * 2) / (points.length - 1);
  const y = (value: number) =>
    span === 0
      ? height / 2
      : pad + (height - pad * 2) * (1 - (value - min) / span);
  return points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${(pad + i * step).toFixed(1)},${y(p.value).toFixed(1)}`
    )
    .join(' ');
}

/** "12", "0.92", "1.9k", "3.4M": short enough for a chip. */
export function formatTrendValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${+(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${+(value / 1e3).toFixed(1)}k`;
  if (Number.isInteger(value)) return String(value);
  return String(+value.toPrecision(3));
}

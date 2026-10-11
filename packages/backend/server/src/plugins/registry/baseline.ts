/**
 * What the monitoring agent learns with: an EWMA baseline (mean and spread)
 * and the finding it makes when something is far from it. Shared by the
 * machine checks (monitoring-agent.ts) and the log patterns (log-patterns.ts).
 */

export type Severity = 'warn' | 'critical';

/** How fast a baseline follows new readings. */
export const ALPHA = 0.2;
/** Readings a baseline needs before it judges; health checks a machine needs before a state counts as new. */
export const WARMUP = 10;

export interface Baseline {
  mean: number;
  variance: number;
  samples: number;
  lastValue: number | null;
}

export interface Finding {
  metric: string;
  kind: 'anomaly' | 'new';
  severity: Severity;
  value: number | null;
  baseline: number | null;
  score: number | null;
  summary: string;
}

/** The baseline after one more reading; `alpha` is how much that reading counts. */
export function learn(baseline: Baseline | null, value: number, alpha = ALPHA): Baseline {
  if (!baseline || baseline.samples === 0) {
    return { mean: value, variance: 0, samples: 1, lastValue: value };
  }
  const diff = value - baseline.mean;
  return {
    mean: baseline.mean + alpha * diff,
    // The EWM variance (West, 1979), so it follows the same window as the mean.
    variance: (1 - alpha) * (baseline.variance + alpha * diff * diff),
    samples: baseline.samples + 1,
    lastValue: value,
  };
}

export const round = (value: number) => Math.round(value * 100) / 100;

import type { SpentRun } from './remote-runner';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What one project's runs used over the report's weeks. */
export interface ProjectSpend {
  /** The `#project:` value of the runs' notes; null for notes without one. */
  project: string | null;
  runs: number;
  /** Runs that ended in an error. */
  failed: number;
  costUsd: number;
  tokens: number;
  /** Claim-to-end time summed over the runs. */
  durationMs: number;
  /** Cost per week, in the order of the `weeks` it was grouped by. */
  weekCostUsd: number[];
}

/**
 * Local-midnight Mondays of the last `count` weeks, oldest first; the last is
 * this week's.
 */
export function weekStarts(count: number, now = new Date()): number[] {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(monday);
    start.setDate(monday.getDate() - (count - 1 - i) * 7);
    return start.getTime();
  });
}

/** The `project` value among a note's `key:value` props, if it has one. */
export function projectFromProps(props: string[]): string | null {
  const prop = props.find(p => p.toLowerCase().startsWith('project:'));
  return prop ? prop.slice('project:'.length) || null : null;
}

/**
 * Group runs by the project of the note each ran on, costliest first with
 * runs on unlabelled notes last. Runs before the first week are left out.
 */
export function spendByProject(
  runs: SpentRun[],
  projectOf: (docId: string | null) => string | null,
  weeks: number[]
): ProjectSpend[] {
  const groups = new Map<string | null, ProjectSpend>();
  for (const run of runs) {
    const at = Date.parse(run.createdAt);
    const week = weeks.filter(start => at >= start).length - 1;
    if (week < 0 || at >= weeks[weeks.length - 1] + 7 * DAY_MS) continue;
    const project = projectOf(run.docId);
    let group = groups.get(project);
    if (!group) {
      group = {
        project,
        runs: 0,
        failed: 0,
        costUsd: 0,
        tokens: 0,
        durationMs: 0,
        weekCostUsd: weeks.map(() => 0),
      };
      groups.set(project, group);
    }
    group.runs += 1;
    if (run.status === 'error') group.failed += 1;
    group.costUsd += run.costUsd ?? 0;
    group.tokens += run.tokens ?? 0;
    group.durationMs += run.durationMs ?? 0;
    group.weekCostUsd[week] += run.costUsd ?? 0;
  }
  return [...groups.values()].sort((a, b) => {
    if ((a.project === null) !== (b.project === null)) {
      return a.project === null ? 1 : -1;
    }
    return b.costUsd - a.costUsd;
  });
}

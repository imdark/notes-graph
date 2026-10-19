import { describe, expect, test } from 'vitest';

import type { SpentRun } from './remote-runner';
import { projectFromProps, spendByProject, weekStarts } from './run-spend';

const run = (
  docId: string | null,
  createdAt: Date,
  parts: Partial<SpentRun> = {}
): SpentRun => ({
  docId,
  status: 'done',
  createdAt: createdAt.toISOString(),
  durationMs: 60_000,
  costUsd: 1,
  tokens: 100,
  ...parts,
});

describe('weekStarts', () => {
  test('ends with this week’s Monday, oldest first', () => {
    // Thursday 2026-10-15, local time.
    const weeks = weekStarts(3, new Date(2026, 9, 15, 13, 0));
    expect(weeks.map(w => new Date(w).getDate())).toEqual([28, 5, 12]);
    expect(weeks.every(w => new Date(w).getDay() === 1)).toBe(true);
  });

  test('a Monday starts its own week', () => {
    const weeks = weekStarts(1, new Date(2026, 9, 12, 0, 30));
    expect(new Date(weeks[0]).getDate()).toBe(12);
  });
});

describe('projectFromProps', () => {
  test('takes the project prop, ignoring others', () => {
    expect(projectFromProps(['status:done', 'project:atlas'])).toBe('atlas');
    expect(projectFromProps(['status:done'])).toBeNull();
    expect(projectFromProps([])).toBeNull();
  });
});

describe('spendByProject', () => {
  const weeks = weekStarts(2, new Date(2026, 9, 15));
  const thisWeek = new Date(2026, 9, 14);
  const lastWeek = new Date(2026, 9, 7);
  const projects: Record<string, string> = { a: 'atlas', b: 'beta' };
  const projectOf = (docId: string | null) =>
    (docId && projects[docId]) ?? null;

  test('sums each project’s runs, by week, costliest first', () => {
    const rows = spendByProject(
      [
        run('a', thisWeek, { costUsd: 0.5 }),
        run('a', lastWeek, { costUsd: 0.25, status: 'error' }),
        run('b', thisWeek, { costUsd: 2, tokens: 900, durationMs: null }),
      ],
      projectOf,
      weeks
    );
    expect(rows).toEqual([
      {
        project: 'beta',
        runs: 1,
        failed: 0,
        costUsd: 2,
        tokens: 900,
        durationMs: 0,
        weekCostUsd: [0, 2],
      },
      {
        project: 'atlas',
        runs: 2,
        failed: 1,
        costUsd: 0.75,
        tokens: 200,
        durationMs: 120_000,
        weekCostUsd: [0.25, 0.5],
      },
    ]);
  });

  test('puts runs on notes without a project last, whatever they cost', () => {
    const rows = spendByProject(
      [
        run('x', thisWeek, { costUsd: 9 }),
        run(null, thisWeek),
        run('a', thisWeek),
      ],
      projectOf,
      weeks
    );
    expect(rows.map(r => [r.project, r.runs])).toEqual([
      ['atlas', 1],
      [null, 2],
    ]);
  });

  test('counts unreported cost as nothing and skips runs outside the weeks', () => {
    const rows = spendByProject(
      [
        run('a', thisWeek, { costUsd: null, tokens: null }),
        run('a', new Date(2026, 8, 1)),
        run('a', new Date(2026, 9, 20)),
      ],
      projectOf,
      weeks
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runs: 1, costUsd: 0, tokens: 0 });
  });
});

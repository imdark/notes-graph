import test from 'ava';

import type { GhCommit, GhJob, GhPull, GhRun } from '../github';
import {
  checksState,
  firstParentMerges,
  labelRun,
  nextRelease,
  productionStatus,
  pullReadiness,
  runRanges,
  runSteps,
} from '../release-state';

const sha = (c: string) => c.repeat(40);

const commit = (id: string, message: string, parents: string[]): GhCommit => ({
  sha: id,
  commit: { message },
  parents: parents.map(p => ({ sha: p })),
});

test('next release counts first-parent "Merge pull request" commits only', t => {
  // stage: base ─ m1 (merges #10) ─ s1 (squash of #11) ─ m2 (Merge branch)
  //   ─ m3 (merges #12, whose branch had merged #9 into itself via b1)
  const commits = [
    commit('b0', 'work on #9', ['base']),
    commit('b1', 'Merge pull request #9 from x/y', ['b0', 'zz']),
    commit('f1', 'feature', ['base']),
    commit('m1', 'Merge pull request #10 from imdark/personal-1-a', [
      'base',
      'f1',
    ]),
    commit('s1', 'Squashed change (#11)', ['m1']),
    commit('m2', "Merge branch 'main' into stage", ['s1', 'main1']),
    commit('m3', 'Merge pull request #12 from imdark/personal-2-b', [
      'm2',
      'b1',
    ]),
  ];
  t.deepEqual(firstParentMerges(commits, 'm3'), [12, 10]);

  const pulls = new Map<number, GhPull>(
    [10, 12].map(number => [
      number,
      {
        number,
        title: `PR ${number}`,
        html_url: `https://github.com/o/r/pull/${number}`,
        state: 'closed',
        user: { login: 'mk' },
        head: { ref: `personal-${number}-x`, sha: 'h' },
        base: { ref: 'stage' },
        merged_at: '2026-11-12T00:00:00Z',
      } satisfies GhPull,
    ])
  );
  const next = nextRelease({ ahead_by: 7, commits }, 'm3', pulls);
  t.is(next.sha, 'm3');
  t.is(next.commits, 7);
  t.deepEqual(
    next.prs.map(pr => [pr.number, pr.branch, pr.author, pr.mergedAt]),
    [
      [12, 'personal-12-x', 'mk', '2026-11-12T00:00:00Z'],
      [10, 'personal-10-x', 'mk', '2026-11-12T00:00:00Z'],
    ]
  );
  t.deepEqual(nextRelease({ ahead_by: 0, commits: [] }, 'm3', pulls), {
    sha: null,
    commits: 0,
    prs: [],
  });
});

test('readiness table', t => {
  const cases: [
    { draft?: boolean; mergeable_state?: string },
    ReturnType<typeof checksState>,
    string,
  ][] = [
    [{ draft: true, mergeable_state: 'clean' }, 'pass', 'draft'],
    [{ mergeable_state: 'dirty' }, 'pass', 'conflicts'],
    [{ mergeable_state: 'dirty' }, 'fail', 'conflicts'],
    [{ mergeable_state: 'clean' }, 'fail', 'failing'],
    [{ mergeable_state: 'unstable' }, 'pending', 'pending'],
    [{ mergeable_state: 'clean' }, 'pass', 'ready'],
    [{ mergeable_state: 'unstable' }, 'none', 'ready'],
    [{ mergeable_state: 'has_hooks' }, 'pass', 'ready'],
    [{ mergeable_state: 'behind' }, 'none', 'ready'],
    [{ mergeable_state: 'blocked' }, 'pass', 'unknown'],
    [{ mergeable_state: 'unknown' }, 'pass', 'unknown'],
    [{}, 'none', 'unknown'],
  ];
  for (const [pull, checks, readiness] of cases) {
    t.is(pullReadiness(pull, checks), readiness, JSON.stringify([pull, checks]));
  }
});

test('checks add up runs and statuses', t => {
  t.is(checksState([], null), 'none');
  t.is(checksState([], { state: 'pending', statuses: [] }), 'none');
  t.is(
    checksState([{ status: 'completed', conclusion: 'success' }], null),
    'pass'
  );
  t.is(
    checksState(
      [
        { status: 'in_progress', conclusion: null },
        { status: 'completed', conclusion: 'failure' },
      ],
      null
    ),
    'fail'
  );
  t.is(checksState([{ status: 'queued', conclusion: null }], null), 'pending');
  t.is(
    checksState([], { state: 'failure', statuses: [{ state: 'error' }] }),
    'fail'
  );
  t.is(
    checksState([{ status: 'completed', conclusion: 'skipped' }], {
      state: 'pending',
      statuses: [{ state: 'pending' }],
    }),
    'pending'
  );
});

const step = (name: string, status: string, conclusion: string | null) => ({
  name,
  status,
  conclusion,
  number: 1,
});

test('run steps: a deploy in progress', t => {
  const jobs: GhJob[] = [
    {
      id: 1,
      name: 'deploy',
      status: 'in_progress',
      conclusion: null,
      steps: [
        step('Deploy record', 'completed', 'success'),
        step('Check image', 'completed', 'skipped'),
        step('Build and push image', 'completed', 'success'),
        step('Roll the box', 'in_progress', null),
        step('Verify', 'queued', null),
      ],
    },
  ];
  t.deepEqual(runSteps(jobs), [
    { name: 'Build image', status: 'done' },
    { name: 'Roll the box', status: 'running' },
    { name: 'Verify', status: 'pending' },
  ]);
});

test('run steps: a rollback builds nothing, its check stands in', t => {
  const jobs: GhJob[] = [
    {
      id: 1,
      name: 'deploy',
      status: 'completed',
      conclusion: 'success',
      steps: [
        step('Check image', 'completed', 'success'),
        step('Build and push image', 'completed', 'skipped'),
        step('Roll the box', 'completed', 'success'),
        step('Verify', 'completed', 'success'),
      ],
    },
  ];
  t.deepEqual(
    runSteps(jobs).map(s => s.status),
    ['done', 'done', 'done']
  );
});

test('run steps: a failure before the build shows on the build', t => {
  const jobs: GhJob[] = [
    {
      id: 1,
      name: 'deploy',
      status: 'completed',
      conclusion: 'failure',
      steps: [
        step('Free disk', 'completed', 'failure'),
        step('Check image', 'completed', 'skipped'),
        step('Build and push image', 'completed', 'skipped'),
        step('Roll the box', 'completed', 'skipped'),
        step('Verify', 'completed', 'skipped'),
      ],
    },
  ];
  t.deepEqual(
    runSteps(jobs).map(s => s.status),
    ['failed', 'skipped', 'skipped']
  );
  t.deepEqual(
    runSteps([]).map(s => s.status),
    ['pending', 'pending', 'pending']
  );
});

test('a rollback run is labelled from its title', t => {
  t.deepEqual(labelRun({ display_title: `Roll back to ${sha('a')}` }), {
    rollbackTo: sha('a'),
  });
  t.deepEqual(labelRun({ display_title: `Deploy ${sha('a')}` }), {
    rollbackTo: null,
  });
  t.deepEqual(labelRun({ display_title: 'Roll back to abc' }), {
    rollbackTo: null,
  });
  t.deepEqual(labelRun({}), { rollbackTo: null });
});

const run = (
  id: number,
  head: string,
  conclusion: string | null,
  options: { status?: string; title?: string } = {}
): GhRun => ({
  id,
  html_url: `https://github.com/o/r/actions/runs/${id}`,
  head_sha: head,
  head_branch: 'main',
  display_title: options.title ?? `Deploy ${head}`,
  status: options.status ?? 'completed',
  conclusion,
  created_at: '2026-11-12T00:00:00Z',
  updated_at: '2026-11-12T00:20:00Z',
  run_started_at: '2026-11-12T00:01:00Z',
});

test('each run holds the pull requests since the previous release', async t => {
  // newest first
  const runs = [
    run(6, sha('e'), null, { status: 'in_progress' }),
    run(5, sha('d'), 'success', { title: `Roll back to ${sha('b')}` }),
    run(4, sha('d'), 'success'),
    run(3, sha('c'), 'failure'),
    run(2, sha('b'), 'success'),
    run(1, sha('a'), 'success'),
  ];
  const asked: string[] = [];
  const between = async (base: string, head: string) => {
    asked.push(`${base[0]}..${head[0]}`);
    return { 'a..b': [1], 'b..c': [2], 'b..d': [2, 3], 'd..e': [4] }[
      `${base[0]}..${head[0]}`
    ]!;
  };
  const memo = new Map<string, number[]>();
  const ranges = await runRanges(runs, between, memo);
  t.deepEqual(ranges.get(6), [4]); // measured from 4: a rollback isn't a release
  t.deepEqual(ranges.get(5), []); // a rollback ships nothing new
  t.deepEqual(ranges.get(4), [2, 3]);
  t.deepEqual(ranges.get(3), [2]); // a failed run still names what it tried
  t.deepEqual(ranges.get(2), [1]);
  t.deepEqual(ranges.get(1), []); // the first run has nothing before it
  t.is(asked.length, 4);

  // ranges never change: asked once
  await runRanges(runs, between, memo);
  t.is(asked.length, 4);
});

test('production status', t => {
  t.is(productionStatus([]), 'unknown');
  t.is(
    productionStatus([
      run(2, sha('b'), null, { status: 'queued' }),
      run(1, sha('a'), 'success'),
    ]),
    'deploying'
  );
  t.is(
    productionStatus([run(2, sha('b'), 'failure'), run(1, sha('a'), 'success')]),
    'failed'
  );
  t.is(
    productionStatus([
      run(2, sha('b'), 'cancelled'),
      run(1, sha('a'), 'success'),
    ]),
    'failed'
  );
  t.is(
    productionStatus([
      run(2, sha('b'), 'success', { title: `Roll back to ${sha('a')}` }),
      run(1, sha('a'), 'success'),
    ]),
    'rolled-back'
  );
  t.is(
    productionStatus([run(2, sha('b'), 'skipped'), run(1, sha('a'), 'success')]),
    'live'
  );
});

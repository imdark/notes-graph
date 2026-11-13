/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import type { AgentRun } from '../stores/agent-runs';
import type { Agent } from '../stores/agents';
import {
  branchCheckCommand,
  briefPull,
  canFixToMerge,
  checkedCount,
  checksState,
  defaultReleaseSettings,
  deleteBranchCommand,
  deletesBranch,
  deployableTasks,
  deployedNote,
  fixTarget,
  formatDuration,
  isCheckedStatus,
  mergeConfirmText,
  productionPill,
  readyPulls,
  releaseAction,
  releaseBlocker,
  releaseConfirmText,
  releasePollMs,
  releaseStageOf,
  rollbackConfirmText,
  rollbackTargets,
  runOutcome,
  tokenMissingText,
  validateReleaseSettings,
  DeployRepoMissing,
  deployReposFor,
  deployRunsFor,
  findPullRequest,
  flagStage,
  isShipStage,
  keptBranches,
  lastLogLine,
  liveCheckNote,
  mergeCommand,
  mergeReadiness,
  mergesDirectly,
  needsHelpToMerge,
  parseBranchChecks,
  parsePullRequests,
  type PullRequest,
  pullRequestNumber,
  pullRequestsCommand,
  pullRequestStage,
  type RunTask,
  SHIP_AUTOMATIONS,
  shipAgents,
  shipBrief,
  shipReportText,
  shipRepos,
  type ShipStage,
  shipsWithAutomations,
  shipTargets,
  shownStage,
  stepResult,
  stuckReason,
  unlistedPullRequests,
  verifyBrief,
} from './deployments';
import type { ReleasePull, ReleaseRun, ReleaseState } from './remote-runner';

const task = (blockId: string, stage: ShipStage, pullRequest?: string) => ({
  docId: 'd1',
  blockId,
  stage,
  text: `${stage.toUpperCase()} task ${blockId}`,
  title: `task ${blockId}`,
  docTitle: '2026-10-06',
  pullRequest: pullRequest ?? null,
});

const agent = (id: string, patch: Partial<Agent>): Agent => ({
  id,
  scope: 'personal',
  name: id,
  instructions: '',
  tools: [],
  targets: ['block'],
  output: 'panel',
  maxSteps: 8,
  enabled: true,
  createdAt: 0,
  harness: 'remote',
  deviceKey: 'mac',
  model: 'claude-code',
  ...patch,
});

describe('isShipStage', () => {
  test('only the three ship keywords, as indexed', () => {
    expect(isShipStage('committed')).toBe(true);
    expect(isShipStage('merged')).toBe(true);
    expect(isShipStage('deployed')).toBe(true);
    expect(isShipStage('COMMITTED')).toBe(false);
    expect(isShipStage('done')).toBe(false);
    expect(isShipStage(undefined)).toBe(false);
  });
});

describe('findPullRequest', () => {
  test('finds the first GitHub PR in a task and its notes', () => {
    expect(
      findPullRequest(
        'Commit c431a5e, PR #46 (https://github.com/imdark/notes-graph/pull/46). Then https://github.com/imdark/notes-graph/pull/47'
      )
    ).toBe('https://github.com/imdark/notes-graph/pull/46');
  });

  test('none when no PR is named', () => {
    expect(
      findPullRequest('see https://github.com/imdark/notes-graph')
    ).toBeNull();
  });
});

describe('shipTargets', () => {
  const tasks = [
    task('a', 'committed'),
    task('b', 'merged'),
    task('c', 'deployed'),
  ];

  test('a merge takes only open PRs', () => {
    expect(shipTargets(tasks, 'merge').map(t => t.blockId)).toEqual(['a']);
  });

  test('a deploy takes merged ones and those still to merge, not live ones', () => {
    expect(shipTargets(tasks, 'deploy').map(t => t.blockId)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('deployRunsFor', () => {
  const run = (id: string, patch: Partial<AgentRun>): AgentRun => ({
    id,
    agentId: 'claude',
    agentName: 'Claude Code',
    targetKind: 'selection',
    docId: 'd1',
    status: 'done',
    startedAt: 0,
    ...patch,
  });
  const worked = run('r1', { targetKind: 'block', blockId: 'a' });

  test('deploy briefs on one of its blocks, not merges or other blocks', () => {
    const runs = [
      run('deploy', { blockIds: ['a'], input: '# Deploy 1 feature\n\n…' }),
      run('both', {
        blockIds: ['b', 'a'],
        input: '# Merge and deploy 2 features\n',
      }),
      run('merge', { blockIds: ['a'], input: '# Merge 1 pull request\n' }),
      run('other-block', { blockIds: ['c'], input: '# Deploy 1 feature\n' }),
      run('other-doc', {
        docId: 'd2',
        blockIds: ['a'],
        input: '# Deploy 1 feature\n',
      }),
      worked,
    ];
    expect(deployRunsFor(runs, worked).map(r => r.id)).toEqual([
      'deploy',
      'both',
    ]);
  });

  test('a run on the whole note has no task to have been deployed', () => {
    const onDoc = run('r2', { targetKind: 'doc' });
    expect(
      deployRunsFor(
        [run('deploy', { blockIds: ['a'], input: '# Deploy 1 feature' })],
        onDoc
      )
    ).toEqual([]);
  });
});

describe('deployableTasks', () => {
  const runTask = (
    blockId: string,
    stage: RunTask['stage'],
    status: string | null
  ): RunTask => ({
    docId: 'd1',
    blockId,
    title: `task ${blockId}`,
    docTitle: '2026-10-25',
    status,
    stage,
    pullRequest: null,
  });

  test('committed and merged go out; live, open and plain blocks do not', () => {
    const tasks = [
      runTask('a', 'committed', 'COMMITTED'),
      runTask('b', 'merged', 'MERGED'),
      runTask('c', 'deployed', 'DEPLOYED'),
      runTask('d', null, 'IN-PROGRESS'),
      runTask('e', null, null),
    ];
    expect(deployableTasks(tasks)).toEqual([
      expect.objectContaining({
        blockId: 'a',
        stage: 'committed',
        text: 'task a',
      }),
      expect.objectContaining({ blockId: 'b', stage: 'merged' }),
    ]);
  });
});

describe('shipAgents', () => {
  test('Claude Code on a device, plain Claude Code first', () => {
    const agents = [
      agent('workflow', { model: 'workflow' }),
      agent('research', { model: 'research' }),
      agent('cloud', { harness: 'cloud' }),
      agent('no-device', { deviceKey: undefined }),
      agent('off', { enabled: false }),
      agent('claude', {}),
    ];
    expect(shipAgents(agents).map(a => a.id)).toEqual(['claude', 'workflow']);
  });
});

describe('verifyBrief', () => {
  const closed = 'https://github.com/o/r/pull/9';
  const tasks = [
    { ...task('a', 'committed'), stuck: 'No pull request' },
    { ...task('b', 'committed', closed), stuck: 'Closed without merging' },
  ];

  test('names each task, why it is stuck and its pull request', () => {
    const brief = verifyBrief(tasks);
    expect(brief.title).toBe('Verify 2 tasks not ready to merge');
    expect(brief.label).toBe('2 tasks');
    expect(brief.text).toContain('block a in note "2026-10-06" (doc d1)');
    expect(brief.text).toContain("why it's here: Closed without merging");
    expect(brief.text).toContain(`pull request: ${closed}`);
    expect(brief.text).toContain('pull request: none named');
  });

  test('sets statuses with evidence, and never merges, deploys or marks done unverified', () => {
    const { text } = verifyBrief(tasks);
    for (const status of ['`deployed`', '`merged`', '`done`', '`todo`']) {
      expect(text).toContain(status);
    }
    expect(text).toContain(
      'Never `done`: that waits for someone to check it live'
    );
    expect(text).toContain('Don’t merge, push, open or close PRs');
    expect(text).toContain('read the note before trying again');
    // No repos set: it speaks of main.
    expect(text).toContain('the feature should be in main');
    expect(text).not.toContain('## Branches');
  });

  test('uses the repo branches the screen has set', () => {
    const { text } = verifyBrief(tasks, [
      { repo: 'o/r', baseBranch: 'stage', deployBranch: 'main' },
    ]);
    expect(text).toContain(
      '- o/r: pull requests merge into `stage`; prod deploys from `main`'
    );
    expect(text).toContain('the feature should be in its repo’s base branch');
  });
});

describe('shipBrief', () => {
  test('a deploy with work still to merge says to merge first', () => {
    const brief = shipBrief(
      [
        task('a', 'committed', 'https://github.com/o/r/pull/1'),
        task('b', 'merged'),
      ],
      'deploy'
    );
    expect(brief.title).toBe('Merge and deploy 2 features');
    expect(brief.text).toContain('https://github.com/o/r/pull/1');
    expect(brief.text).toContain('block a in note "2026-10-06" (doc d1)');
    expect(brief.text).toContain('First merge');
    expect(brief.text).toContain('deploy-prod');
    expect(brief.text).toContain('`deployed`');
  });

  test('a deploy rebuilds the APK only when it changed the Android app', () => {
    const brief = shipBrief([task('b', 'merged')], 'deploy');
    expect(brief.text).toContain(
      '-- packages/frontend/apps/android packages/frontend/mobile-native'
    );
    expect(brief.text).toContain('deploy-android-apk');
    expect(brief.text).toContain("If nothing changed, don't build it");
    // After the prod deploy, never alongside it.
    expect(brief.text.indexOf('deploy-android-apk')).toBeGreaterThan(
      brief.text.indexOf('deploy-prod')
    );
  });

  test('a deploy of merged work only goes straight to deploying', () => {
    const brief = shipBrief([task('b', 'merged')], 'deploy');
    expect(brief.title).toBe('Deploy 1 feature');
    expect(brief.text).not.toContain('First merge');
  });

  test("a merge doesn't deploy", () => {
    const brief = shipBrief([task('a', 'committed')], 'merge');
    expect(brief.title).toBe('Merge 1 pull request');
    expect(brief.text).toContain("Don't deploy.");
    expect(brief.text).not.toContain('deploy-prod');
    expect(brief.text).not.toContain('deploy-android-apk');
  });

  test('says what GitHub says, and takes pull requests no task names', () => {
    const url = 'https://github.com/o/r/pull/1';
    const brief = shipBrief([task('a', 'committed', url)], 'merge', {
      pulls: [pull({ url, number: 1, mergeable: 'CONFLICTING' })],
      untracked: [pull({ url: 'https://github.com/o/r/pull/2', number: 2 })],
    });
    expect(brief.title).toBe('Merge 2 pull requests');
    expect(brief.text).toContain('on GitHub: conflicts with main');
    expect(brief.text).toContain('## Pull requests no task names');
    expect(brief.text).toContain('https://github.com/o/r/pull/2');
    expect(brief.text).toContain('merge main into it');
  });

  test("with the repos' branches it names them, never main", () => {
    const url = 'https://github.com/o/r/pull/1';
    const repos = [{ repo: 'o/r', baseBranch: 'stage', deployBranch: 'main' }];
    const merge = shipBrief(
      [task('a', 'committed', url)],
      'merge',
      { pulls: [pull({ url, number: 1, mergeable: 'CONFLICTING' })] },
      repos
    );
    expect(merge.text).toContain(
      '- o/r: pull requests merge into `stage`; prod deploys from `main`'
    );
    expect(merge.text).toContain('into its repo’s base branch');
    expect(merge.text).toContain('on GitHub: conflicts with its repo’s base');
    expect(merge.text).not.toContain('into main');
    const deploy = shipBrief([task('b', 'merged', url)], 'deploy', {}, repos);
    expect(deploy.text).toContain(
      'Update to the latest commit of the repo’s deploy branch'
    );
  });
});

describe('repo branches', () => {
  test("a ship's repos: its pull requests', untracked ones', and prod's", () => {
    expect(
      shipRepos(
        [
          task('a', 'committed', 'https://github.com/o/r/pull/1'),
          task('b', 'committed'),
          task('c', 'merged', 'https://github.com/o/r/pull/2'),
        ],
        [pull({ repo: 'x/y' })],
        'o/prod'
      )
    ).toEqual(['o/prod', 'o/r', 'x/y']);
  });

  test('a repo without its branches is refused, never guessed', () => {
    const set = { repo: 'o/r', baseBranch: 'stage', deployBranch: 'main' };
    expect(deployReposFor(['o/r'], [set])).toEqual([set]);
    expect(() => deployReposFor(['o/r', 'x/y'], [set])).toThrow(
      DeployRepoMissing
    );
    expect(() => deployReposFor(['x/y'], [])).toThrow(/x\/y/);
  });
});

const pull = (patch: Partial<PullRequest>): PullRequest => ({
  repo: 'o/r',
  number: 1,
  title: 'A change',
  url: 'https://github.com/o/r/pull/1',
  branch: 'feature',
  author: 'me',
  state: 'open',
  draft: false,
  mergeable: 'MERGEABLE',
  checks: 'pass',
  mergedAt: null,
  ...patch,
});

describe('pullRequestsCommand', () => {
  test('lists open and merged pull requests of each repo, one per line', () => {
    const command = pullRequestsCommand(['o/r']);
    expect(command).toContain("gh pr list -R 'o/r' --state open");
    expect(command).toContain("gh pr list -R 'o/r' --state merged");
    expect(command).toContain("--jq '.[] |");
  });

  test('with no repo, reads it from the device folder', () => {
    expect(pullRequestsCommand([], "/Users/me/it's here")).toMatch(
      /^cd '\/Users\/me\/it'\\''s here' && gh pr list --state open/
    );
  });

  test('merges with a merge commit', () => {
    expect(mergeCommand({ repo: 'o/r', number: 7 })).toBe(
      "gh pr merge 7 -R 'o/r' --merge"
    );
  });
});

describe('parsePullRequests', () => {
  test('reads gh output, skipping anything else', () => {
    const output = [
      'some warning',
      JSON.stringify({
        number: 5,
        title: 'Open one',
        url: 'https://github.com/o/r/pull/5',
        headRefName: 'b5',
        author: { login: 'me' },
        state: 'OPEN',
        isDraft: false,
        mergeable: 'CONFLICTING',
        statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
      }),
      JSON.stringify({
        number: 4,
        title: 'Merged one',
        url: 'https://github.com/o/r/pull/4',
        headRefName: 'b4',
        author: { login: 'me' },
        state: 'MERGED',
        mergedAt: '2026-10-06T10:00:00Z',
      }),
    ].join('\n');
    const [open, merged] = parsePullRequests(output);
    expect(open).toMatchObject({
      repo: 'o/r',
      number: 5,
      state: 'open',
      mergeable: 'CONFLICTING',
      checks: 'pass',
    });
    expect(merged).toMatchObject({
      number: 4,
      state: 'merged',
      mergedAt: Date.parse('2026-10-06T10:00:00Z'),
    });
  });
});

describe('checksState', () => {
  test('any failure fails; anything unfinished is pending', () => {
    expect(checksState([])).toBe('none');
    expect(checksState([{ status: 'COMPLETED', conclusion: 'SUCCESS' }])).toBe(
      'pass'
    );
    expect(
      checksState([
        { status: 'IN_PROGRESS' },
        { status: 'COMPLETED', conclusion: 'FAILURE' },
      ])
    ).toBe('fail');
    expect(checksState([{ status: 'QUEUED' }, { state: 'SUCCESS' }])).toBe(
      'pending'
    );
    expect(checksState([{ state: 'PENDING' }])).toBe('pending');
  });
});

describe('mergeReadiness', () => {
  test('wf merges all but conflicts and drafts; Claude is offered for failures', () => {
    expect(mergeReadiness(pull({}))).toBe('ready');
    expect(mergeReadiness(pull({ mergeable: 'UNKNOWN' }))).toBe('unknown');
    expect(mergeReadiness(pull({ mergeable: 'CONFLICTING' }))).toBe(
      'conflicts'
    );
    expect(mergeReadiness(pull({ checks: 'fail' }))).toBe('failing');
    expect(mergeReadiness(pull({ checks: 'pending' }))).toBe('pending');
    expect(mergeReadiness(pull({ draft: true, checks: 'fail' }))).toBe('draft');
    expect(mergesDirectly('ready')).toBe(true);
    expect(mergesDirectly('unknown')).toBe(true);
    expect(mergesDirectly('failing')).toBe(true);
    expect(mergesDirectly('pending')).toBe(true);
    expect(mergesDirectly('conflicts')).toBe(false);
    expect(mergesDirectly('draft')).toBe(false);
    expect(needsHelpToMerge('conflicts')).toBe(true);
    expect(needsHelpToMerge('failing')).toBe(false);
    expect(canFixToMerge('failing')).toBe(true);
    expect(canFixToMerge('conflicts')).toBe(true);
    expect(canFixToMerge('pending')).toBe(false);
  });
});

describe('pullRequestStage', () => {
  const deploy = {
    repo: 'imdark/notes-graph',
    commit: 'abc1234',
    branch: 'main',
    subject: 'Merge pull request #112',
    dirty: false,
    deployedAt: '2026-10-12T23:55:00Z',
    pullRequests: [112, 111, 110],
  };
  const pr = (
    number: number,
    state: 'open' | 'merged',
    repo = 'imdark/notes-graph'
  ) => ({
    number,
    state,
    url: `https://github.com/${repo}/pull/${number}`,
  });

  test('a merged pull request in the deployed commit is deployed', () => {
    expect(pullRequestStage(pr(111, 'merged'), deploy)).toBe('deployed');
  });

  test('one merged since the deploy is merged, not deployed', () => {
    expect(pullRequestStage(pr(113, 'merged'), deploy)).toBe('merged');
  });

  test('an open one is open, whatever prod runs', () => {
    expect(pullRequestStage(pr(114, 'open'), deploy)).toBe('open');
    expect(pullRequestStage(pr(114, 'open'), null)).toBe('open');
  });

  test("can't tell without a deploy record, or for another repo", () => {
    expect(pullRequestStage(pr(111, 'merged'), null)).toBeNull();
    expect(
      pullRequestStage(pr(19, 'merged', 'imdark/workflow'), deploy)
    ).toBeNull();
  });
});

describe('shownStage', () => {
  const deploy = {
    repo: 'imdark/notes-graph',
    commit: 'abc1234',
    branch: 'main',
    subject: 'Merge pull request #112',
    dirty: false,
    deployedAt: '2026-10-12T23:55:00Z',
    pullRequests: [112, 111, 110],
  };
  const url = (number: number, repo = 'imdark/notes-graph') =>
    `https://github.com/${repo}/pull/${number}`;

  test("a task noted MERGED whose pull request is in prod's build is live", () => {
    expect(shownStage('merged', url(111), true, deploy)).toBe('deployed');
  });

  test('so is one still noted COMMITTED', () => {
    expect(shownStage('committed', url(112), false, deploy)).toBe('deployed');
  });

  test('merged since the deploy, it waits to be deployed', () => {
    expect(shownStage('merged', url(113), true, deploy)).toBe('merged');
    expect(shownStage('committed', url(113), true, deploy)).toBe('merged');
  });

  test('an unmerged pull request keeps the noted stage', () => {
    expect(shownStage('committed', url(114), false, deploy)).toBe('committed');
  });

  test('without a deploy record, another repo or a PR link, the note decides', () => {
    expect(shownStage('merged', url(111), true, null)).toBe('merged');
    expect(
      shownStage('merged', url(111, 'imdark/workflow'), true, deploy)
    ).toBe('merged');
    expect(shownStage('merged', null, false, deploy)).toBe('merged');
  });
});

describe('checking ready branches', () => {
  const prs = [
    {
      repo: 'imdark/notes-graph',
      number: 12,
      url: 'https://github.com/imdark/notes-graph/pull/12',
    },
    {
      repo: 'imdark/notes-graph',
      number: 123,
      url: 'https://github.com/imdark/notes-graph/pull/123',
    },
    {
      repo: 'imdark/notes-graph',
      number: 7,
      url: 'https://github.com/imdark/notes-graph/pull/7',
    },
  ];

  test('reads each pull request back by number and repo, unknown ones as missing', () => {
    const output = [
      'imdark/notes-graph is not asked about',
      '12\timdark/notes-graph\tMERGED\tfeat-x\ttrue',
      '123\timdark/notes-graph\tOPEN\tfix-y\tfalse',
      '7\timdark/notes-graph\tMISSING\t\tfalse',
    ].join('\n');
    expect(parseBranchChecks(output, prs)).toEqual([
      { ...prs[0], state: 'merged', branch: 'feat-x', branchExists: true },
      { ...prs[1], state: 'open', branch: 'fix-y', branchExists: false },
      { ...prs[2], state: 'missing', branch: null, branchExists: false },
    ]);
  });

  test('deletes only a merged branch that is still there, and never main', () => {
    const merged = {
      ...prs[0],
      state: 'merged' as const,
      branch: 'feat-x',
      branchExists: true,
    };
    expect(deletesBranch(merged)).toBe(true);
    expect(deletesBranch({ ...merged, branchExists: false })).toBe(false);
    expect(deletesBranch({ ...merged, state: 'open' })).toBe(false);
    expect(deletesBranch({ ...merged, branch: 'main' })).toBe(false);
    // Nor a branch a repo's setting names.
    const keep = keptBranches([
      { repo: 'imdark/notes-graph', baseBranch: 'stage', deployBranch: 'main' },
    ]);
    expect(deletesBranch({ ...merged, branch: 'stage' }, keep)).toBe(false);
    expect(deletesBranch(merged, keep)).toBe(true);
    expect(deleteBranchCommand(merged)).toBe(
      "gh api -X DELETE 'repos/imdark/notes-graph/git/refs/heads/feat-x'"
    );
  });

  test('a committed task with nothing open to merge says why', () => {
    const pr = prs[0].url;
    const open = { state: 'open' as const, branchExists: true };
    expect(
      stuckReason({ stage: 'committed', pullRequest: null }, undefined)
    ).toBe('No pull request');
    expect(
      stuckReason(
        { stage: 'committed', pullRequest: pr },
        { ...open, state: 'closed' }
      )
    ).toBe('Closed without merging');
    expect(
      stuckReason(
        { stage: 'committed', pullRequest: pr },
        { state: 'missing', branchExists: false }
      )
    ).toBe('Not on GitHub');
    expect(
      stuckReason(
        { stage: 'committed', pullRequest: pr },
        { ...open, branchExists: false }
      )
    ).toBe('Branch deleted');
    // Open with its branch, or not checked yet: ready as far as anyone knows.
    expect(
      stuckReason({ stage: 'committed', pullRequest: pr }, open)
    ).toBeNull();
    expect(
      stuckReason({ stage: 'committed', pullRequest: pr }, undefined)
    ).toBeNull();
    // Only COMMITTED tasks are merged from here.
    expect(
      stuckReason({ stage: 'merged', pullRequest: null }, undefined)
    ).toBeNull();
  });

  test('looks up committed tasks whose pull request the list lacks', () => {
    const url = (n: number) =>
      `https://github.com/imdark/notes-graph/pull/${n}`;
    const tasks = [
      { stage: 'committed' as const, pullRequest: url(1) }, // listed
      { stage: 'committed' as const, pullRequest: url(2) }, // checked already
      { stage: 'committed' as const, pullRequest: url(3) }, // unlisted
      { stage: 'committed' as const, pullRequest: url(3) }, // same, once
      { stage: 'merged' as const, pullRequest: url(4) }, // not to merge
      { stage: 'committed' as const, pullRequest: null },
      { stage: 'committed' as const, pullRequest: 'not a url' },
    ];
    expect(
      unlistedPullRequests(tasks, new Set([url(1)]), new Set([url(2)]))
    ).toEqual([{ repo: 'imdark/notes-graph', number: 3, url: url(3) }]);
  });

  test('asks gh for state and branch, with jq escapes intact', () => {
    const command = branchCheckCommand([prs[0]]);
    expect(command).toContain(`gh pr view 12 -R 'imdark/notes-graph'`);
    expect(command).toContain(`--jq '"\\(.state)\\t\\(.headRefName)"'`);
    expect(command).toContain('repos/imdark/notes-graph/branches/$b');
    expect(pullRequestNumber(prs[1].url)).toBe(123);
  });
});

describe('liveCheckNote', () => {
  const at = new Date(2026, 9, 24);
  const day = at.toLocaleDateString();

  test('a working feature is noted as checked', () => {
    expect(liveCheckNote({ works: true }, at)).toBe(
      `Checked live ${day}: works.`
    );
  });

  test("a broken one carries what's wrong", () => {
    expect(
      liveCheckNote({ works: false, problem: '  keyboard still closes ' }, at)
    ).toBe(`Checked live ${day}: doesn't work. keyboard still closes`);
  });

  test('with nothing typed it still says it does not work', () => {
    expect(liveCheckNote({ works: false, problem: '   ' }, at)).toBe(
      `Checked live ${day}: doesn't work.`
    );
  });
});

describe('flagStage', () => {
  const deploy = {
    repo: 'imdark/notes-graph',
    commit: 'c0ffee',
    branch: 'main',
    subject: 'Merge pull request #9',
    dirty: false,
    deployedAt: '2026-10-27T00:00:00Z',
    pullRequests: [9],
    featureFlags: { enable_x: 'a'.repeat(40) },
  };

  test('deployed when prod lists the flag with its commit', () => {
    expect(flagStage('enable_x', 'a'.repeat(40), deploy)).toBe('deployed');
  });

  test('not deployed when prod lacks it or has another commit', () => {
    expect(flagStage('enable_y', 'b'.repeat(40), deploy)).toBe('not-deployed');
    expect(flagStage('enable_x', 'b'.repeat(40), deploy)).toBe('not-deployed');
  });

  test('unknown without a record, a stamped record, or a commit', () => {
    expect(flagStage('enable_x', 'a'.repeat(40), null)).toBeNull();
    expect(flagStage('enable_x', 'a'.repeat(40), undefined)).toBeNull();
    expect(
      flagStage('enable_x', 'a'.repeat(40), {
        ...deploy,
        featureFlags: undefined,
      })
    ).toBeNull();
    expect(flagStage('enable_x', '', deploy)).toBeNull();
  });
});

describe('shipping with automations', () => {
  test('the cloud runner has no deploy; a wf device has', () => {
    expect(shipsWithAutomations({ deviceKey: 'cloud' })).toBe(false);
    expect(shipsWithAutomations({ deviceKey: undefined })).toBe(false);
    expect(shipsWithAutomations({ deviceKey: 'laptop' })).toBe(true);
  });

  test('the ship automations are wf actions: a gh merge and a cloud deploy', () => {
    expect(SHIP_AUTOMATIONS.merge.code).toContain('type: custom_command');
    expect(SHIP_AUTOMATIONS.merge.code).toContain(
      'gh pr merge {input.number} -R {input.repo} --merge'
    );
    expect(SHIP_AUTOMATIONS.deploy.code).toContain('type: cloud_deploy');
    expect(SHIP_AUTOMATIONS.deploy.timeoutSeconds).toBe(60 * 60);
  });

  test('a step result and the last log line are read off a run', () => {
    expect(stepResult({ deploy: { commit: 'abc' } }, 'deploy')).toEqual({
      commit: 'abc',
    });
    expect(stepResult({ deploy: 'x' }, 'deploy')).toEqual({});
    expect(lastLogLine('one\ntwo\n\n')).toBe('two');
    expect(lastLogLine(undefined)).toBe('');
  });

  test('a deploy notes its short commit', () => {
    expect(deployedNote('abcdef1234', new Date(2026, 9, 25))).toMatch(
      /^Deployed abcdef1 on /
    );
  });

  test('the report says what went out and what needs fixing', () => {
    const report = shipReportText({
      merged: [task('a', 'merged')],
      leftOut: [{ task: task('b', 'committed'), why: 'conflicts\nmore' }],
      deployed: {
        commit: 'abcdef1234',
        verify: 'https://x/ answered HTTP 200',
      },
    });
    expect(report.ok).toBe(false);
    expect(report.title).toBe('Deployed abcdef1');
    expect(report.message).toBe(
      `1 task now DEPLOYED, waiting to be checked live. https://x/ answered HTTP 200 "task b" wasn't merged (conflicts). Fix & merge with Claude from the Deployments page.`
    );
    expect(shipReportText({ merged: [], leftOut: [], deployed: null })).toEqual(
      {
        ok: false,
        title: 'Nothing deployed',
        message: 'Nothing was merged to deploy.',
      }
    );
  });
});

const releasePull = (
  number: number,
  patch: Partial<ReleasePull> = {}
): ReleasePull => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/imdark/notes-graph/pull/${number}`,
  branch: `personal-${number}-x`,
  author: 'mk',
  draft: false,
  mergeableState: 'clean',
  headSha: 'h'.repeat(40),
  checks: 'pass',
  readiness: 'ready',
  mergedAt: null,
  ...patch,
});

const releaseRun = (
  id: number,
  patch: Partial<ReleaseRun> = {}
): ReleaseRun => ({
  id,
  url: `https://github.com/imdark/notes-graph/actions/runs/${id}`,
  sha: String(id).padEnd(40, '0'),
  status: 'completed',
  conclusion: 'success',
  startedAt: '2026-11-12T07:04:00Z',
  durationMs: 19 * 60_000,
  rollbackTo: null,
  prs: [],
  ...patch,
});

const releaseState = (patch: Partial<ReleaseState> = {}): ReleaseState => ({
  settings: {
    repo: 'imdark/notes-graph',
    baseBranch: 'stage',
    deployBranch: 'main',
    workflowFile: 'deploy-prod.yml',
  },
  token: { source: 'secret' },
  production: {
    deployInfo: null,
    run: null,
    status: 'live',
    steps: [],
    mainSha: 'm'.repeat(40),
    stageSha: 's'.repeat(40),
    diverged: false,
  },
  next: { sha: 's'.repeat(40), commits: 4, prs: [releasePull(371)] },
  open: [releasePull(373)],
  history: [],
  tasks: {},
  fetchedAt: '2026-11-12T08:00:00Z',
  error: null,
  ...patch,
});

const production = (
  patch: Partial<ReleaseState['production']>
): ReleaseState['production'] => ({
  ...releaseState().production,
  ...patch,
});

describe('releaseStageOf', () => {
  const deployInfo = {
    repo: 'imdark/notes-graph',
    commit: 'c'.repeat(40),
    branch: 'main',
    subject: 'Merge pull request #368',
    dirty: false,
    deployedAt: '2026-11-12T07:24:00Z',
    pullRequests: [368, 367],
  };

  test('open, on stage, then live by prod’s own record', () => {
    const state = releaseState({
      production: production({ deployInfo }),
      history: [releaseRun(2, { prs: [368, 367] })],
    });
    expect(releaseStageOf(373, state)).toBe('open');
    expect(releaseStageOf(371, state)).toBe('on stage');
    expect(releaseStageOf(368, state)).toBe('live');
  });

  test('released but not in prod: a deploy going, failed, or rolled back', () => {
    const state = releaseState({
      production: production({ deployInfo, status: 'deploying' }),
      history: [
        releaseRun(3, { status: 'in_progress', conclusion: null, prs: [369] }),
      ],
    });
    expect(releaseStageOf(369, state)).toBe('released');
  });

  test('without a deploy record, a good release that is still live counts', () => {
    const history = [releaseRun(2, { prs: [369] })];
    expect(releaseStageOf(369, releaseState({ history }))).toBe('live');
    expect(
      releaseStageOf(
        369,
        releaseState({ history, production: production({ status: 'failed' }) })
      )
    ).toBe('released');
  });

  test('unknown when the state has nothing on it', () => {
    expect(releaseStageOf(1, releaseState())).toBeNull();
    expect(releaseStageOf(373, null)).toBeNull();
    expect(releaseStageOf(373, undefined)).toBeNull();
  });
});

describe('validateReleaseSettings', () => {
  const good = {
    repo: ' imdark/notes-graph ',
    baseBranch: 'stage',
    deployBranch: 'main',
    workflowFile: 'deploy-prod.yml',
  };

  test('trims and accepts what the server does', () => {
    expect(validateReleaseSettings(good)).toEqual({
      ok: true,
      settings: { ...good, repo: 'imdark/notes-graph' },
    });
    expect(
      validateReleaseSettings({ ...good, workflowFile: 'deploy.yaml' }).ok
    ).toBe(true);
  });

  test('refuses a bad repo, branch or workflow, one problem at a time', () => {
    const error = (patch: Partial<typeof good>) => {
      const result = validateReleaseSettings({ ...good, ...patch });
      return result.ok ? null : result.error;
    };
    expect(error({ repo: 'notes-graph' })).toMatch(/owner\/name/);
    expect(error({ baseBranch: 'a..b' })).toMatch(/Base branch/);
    expect(error({ deployBranch: 'main/' })).toMatch(/Deploy branch/);
    expect(error({ deployBranch: 'stage' })).toMatch(/must differ/);
    expect(error({ workflowFile: 'deploy-prod' })).toMatch(/\.yml/);
    expect(error({ workflowFile: '../x.yml' })).toMatch(/\.yml/);
  });

  test('the dialog starts prefilled from the deploy record', () => {
    expect(
      defaultReleaseSettings({
        repo: 'o/r',
        commit: 'c',
        branch: 'main',
        subject: '',
        dirty: false,
        deployedAt: '',
        pullRequests: [],
      })
    ).toEqual({
      repo: 'o/r',
      baseBranch: 'stage',
      deployBranch: 'main',
      workflowFile: 'deploy-prod.yml',
    });
    expect(defaultReleaseSettings(null).repo).toBe('');
  });
});

describe('release copy', () => {
  test('the pill says what prod is doing', () => {
    expect(productionPill(releaseState())).toEqual({
      label: 'Live',
      tone: 'good',
    });
    expect(
      productionPill(
        releaseState({
          production: production({
            status: 'deploying',
            run: releaseRun(5, { status: 'waiting', conclusion: null }),
          }),
        })
      ).label
    ).toBe('Deploying · waiting for approval');
    expect(
      productionPill(
        releaseState({
          production: production({
            status: 'rolled-back',
            run: releaseRun(6, { rollbackTo: 'abc1234def'.padEnd(40, '0') }),
          }),
        })
      ).label
    ).toBe('Rolled back to abc1234');
    expect(
      productionPill(
        releaseState({ production: production({ status: 'failed' }) })
      ).tone
    ).toBe('bad');
  });

  test('Release counts the PRs and says why it is off', () => {
    expect(releaseAction(releaseState())).toEqual({
      label: 'Release (1)',
      count: 1,
      disabled: false,
      reason: null,
    });
    expect(
      releaseAction(
        releaseState({ next: { sha: 'm'.repeat(40), commits: 0, prs: [] } })
      ).reason
    ).toBe('main is at stage: nothing to release.');
    expect(
      releaseAction(
        releaseState({ production: production({ diverged: true }) })
      ).reason
    ).toMatch(/^main has commits stage lacks/);
    expect(
      releaseAction(
        releaseState({ production: production({ status: 'deploying' }) })
      ).disabled
    ).toBe(true);
    // A failed deploy leaves it on, so a fix can go out.
    expect(
      releaseAction(
        releaseState({ production: production({ status: 'failed' }) })
      ).disabled
    ).toBe(false);
  });

  test('the confirms say what they do', () => {
    const state = releaseState();
    expect(releaseConfirmText(state)).toBe(
      'Fast-forwards main to stage (sssssss, 1 PR) and starts deploy-prod.yml.'
    );
    expect(mergeConfirmText(releasePull(373), state.settings)).toBe(
      'Merge #373 into stage with a merge commit and delete personal-373-x.'
    );
    expect(rollbackConfirmText('abcdef1234')).toBe(
      'Rolls prod back to the image of abcdef1 without rebuilding.'
    );
  });

  test('a token missing points at the Secrets page, the desktop one on a phone', () => {
    expect(tokenMissingText(false)).toContain('on the Secrets page.');
    expect(tokenMissingText(true)).toContain("the desktop app's Secrets page");
    expect(tokenMissingText(false)).toContain('GITHUB_TOKEN');
    expect(releaseBlocker(releaseState())).toBeNull();
    expect(releaseBlocker(releaseState({ settings: null }))).toBe(
      'no-settings'
    );
    expect(releaseBlocker(releaseState({ token: { source: null } }))).toBe(
      'no-token'
    );
  });

  test('History rows: outcome, duration, checked k/n', () => {
    expect(runOutcome(releaseRun(1))).toEqual({ label: '✓', tone: 'good' });
    expect(runOutcome(releaseRun(1, { conclusion: 'failure' })).label).toBe(
      '✗'
    );
    expect(runOutcome(releaseRun(1, { conclusion: 'cancelled' })).label).toBe(
      'cancelled'
    );
    expect(
      runOutcome(releaseRun(1, { status: 'in_progress', conclusion: null }))
        .label
    ).toBe('in progress');
    expect(formatDuration(19 * 60_000)).toBe('19 min');
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(null)).toBe('');
    const task = (status: string | null) => ({
      docId: 'd',
      blockId: 'b',
      title: 't',
      status,
    });
    expect(
      checkedCount([1, 2, 3], {
        1: [task('done')],
        2: [task('done'), task('deployed')],
      })
    ).toEqual({ checked: 1, total: 3 });
    expect(isCheckedStatus('[X]')).toBe(true);
    expect(isCheckedStatus('DEPLOYED')).toBe(false);
  });

  test('Merge all takes the ready ones, oldest first', () => {
    expect(
      readyPulls([
        releasePull(9),
        releasePull(3),
        releasePull(4, { readiness: 'conflicts' }),
        releasePull(5, { readiness: 'draft' }),
      ]).map(pr => pr.number)
    ).toEqual([3, 9]);
  });

  test('Roll back offers earlier good images, not the live one', () => {
    const live = releaseRun(9);
    const state = releaseState({
      production: production({ run: live }),
      history: [
        live,
        releaseRun(8, { conclusion: 'failure' }),
        releaseRun(7),
        releaseRun(6, { rollbackTo: releaseRun(7).sha }),
        releaseRun(5),
      ],
    });
    expect(rollbackTargets(state).map(t => t.run.id)).toEqual([7, 5]);
  });

  test('polls faster while a deploy runs', () => {
    expect(releasePollMs(releaseState())).toBe(60_000);
    expect(
      releasePollMs(
        releaseState({ production: production({ status: 'deploying' }) })
      )
    ).toBe(15_000);
    expect(releasePollMs(undefined)).toBe(60_000);
  });
});

describe('fixWithClaude', () => {
  const linked = {
    docId: 'd1',
    blockId: 'b1',
    title: 't',
    status: 'committed',
  };

  test('files the run on the PR’s task, else any linked task’s note', () => {
    expect(fixTarget({ number: 1 }, { 1: [linked] })).toEqual({
      kind: 'selection',
      docId: 'd1',
      blockIds: ['b1'],
    });
    expect(
      fixTarget({ number: 1 }, {}, { docId: 'd9', blockId: 'b9' })
    ).toEqual({ kind: 'selection', docId: 'd9', blockIds: ['b9'] });
    expect(fixTarget({ number: 1 }, { 2: [linked] })).toEqual({
      kind: 'doc',
      docId: 'd1',
    });
    expect(fixTarget({ number: 1 }, {})).toBeNull();
  });

  test('the brief is the existing merge brief, with the repo’s branches', () => {
    const pr = briefPull(
      releasePull(374, { readiness: 'conflicts', mergeableState: 'dirty' }),
      'imdark/notes-graph'
    );
    expect(pr).toMatchObject({
      repo: 'imdark/notes-graph',
      number: 374,
      state: 'open',
      mergeable: 'CONFLICTING',
    });
    const brief = shipBrief([], 'merge', { untracked: [pr] }, [
      { repo: 'imdark/notes-graph', baseBranch: 'stage', deployBranch: 'main' },
    ]);
    expect(brief.title).toBe('Merge 1 pull request');
    expect(brief.text).toContain(pr.url);
    expect(brief.text).toContain('merge into `stage`');
  });
});

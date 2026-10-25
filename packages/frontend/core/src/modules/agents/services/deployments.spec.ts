/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import type { AgentRun } from '../stores/agent-runs';
import type { Agent } from '../stores/agents';
import {
  branchCheckCommand,
  canFixToMerge,
  checksState,
  deleteBranchCommand,
  deletesBranch,
  deployableTasks,
  deployRunsFor,
  findPullRequest,
  isShipStage,
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
  shipAgents,
  shipBrief,
  type ShipStage,
  shipTargets,
  shownStage,
  stuckReason,
} from './deployments';

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

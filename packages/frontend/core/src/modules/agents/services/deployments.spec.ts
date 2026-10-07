/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import type { Agent } from '../stores/agents';
import {
  canFixToMerge,
  checksState,
  findPullRequest,
  isShipStage,
  mergeCommand,
  mergeReadiness,
  mergesDirectly,
  needsHelpToMerge,
  parsePullRequests,
  type PullRequest,
  pullRequestsCommand,
  shipAgents,
  shipBrief,
  type ShipStage,
  shipTargets,
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

/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import type { Agent } from '../stores/agents';
import {
  findPullRequest,
  isShipStage,
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
    expect(brief.title).toBe('Merge 1 feature');
    expect(brief.text).toContain("Don't deploy.");
    expect(brief.text).not.toContain('deploy-prod');
  });
});

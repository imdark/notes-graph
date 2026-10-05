import { describe, expect, test } from 'vitest';

import type { AgentRun } from '../stores/agent-runs';
import { hasAgentClaim, runsForBlock } from './block-runs';

const run = (id: string, target: Partial<AgentRun>): AgentRun => ({
  id,
  agentId: 'a1',
  agentName: 'Agent',
  targetKind: target.blockIds ? 'selection' : target.blockId ? 'block' : 'doc',
  docId: 'd1',
  status: 'done',
  startedAt: 0,
  ...target,
});

describe('runsForBlock', () => {
  const runs = [
    run('on-block', { blockId: 'b1' }),
    run('in-selection', { blockIds: ['b0', 'b1'] }),
    run('on-list', { blockId: 'list' }),
    run('on-doc', {}),
    run('elsewhere', { blockId: 'b9' }),
  ];

  test('a run pointed at the block counts, alone or in a selection', () => {
    expect(runsForBlock(runs, 'b1', [], false).map(r => r.id)).toEqual([
      'on-block',
      'in-selection',
    ]);
  });

  test('a run on the list above counts only once the block is claimed', () => {
    expect(runsForBlock(runs, 'b2', ['list'], false)).toEqual([]);
    expect(runsForBlock(runs, 'b2', ['list'], true).map(r => r.id)).toEqual([
      'on-list',
    ]);
  });
});

describe('hasAgentClaim', () => {
  test('the server-decorated token', () => {
    expect(
      hasAgentClaim([
        { insert: 'Fix it ' },
        { insert: '@claude', attributes: { orgMention: 'claude' } },
      ])
    ).toBe(true);
  });

  test('a typed token', () => {
    expect(hasAgentClaim([{ insert: 'Fix it @claude-opus-5-5' }])).toBe(true);
  });

  test('not an email or a bare @', () => {
    expect(hasAgentClaim([{ insert: 'Mail me@example.com' }])).toBe(false);
    expect(hasAgentClaim([{ insert: 'meet @ noon' }])).toBe(false);
  });
});

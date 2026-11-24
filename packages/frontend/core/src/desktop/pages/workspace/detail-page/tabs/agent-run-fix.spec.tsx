/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import { runFailure } from './agent-run-fix';

const run = {
  id: 'r1',
  agentId: 'a1',
  agentName: 'Planner',
  targetKind: 'doc',
  docId: 'doc1',
  title: 'Plan the week',
  status: 'error',
  startedAt: 0,
  error: 'boom',
  deviceKey: 'box-1',
  model: 'm',
} as const;

describe('runFailure', () => {
  test('carries the run metadata, error and the end of the log', () => {
    const log = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const failure = runFailure({ ...run }, log, 'the answer');
    expect(failure.title).toContain('Plan the week');
    expect(failure.sourceDocId).toBe('doc1');
    expect(failure.deviceKey).toBe('box-1');
    expect(failure.details).toContain('Error: boom');
    expect(failure.details).toContain('Its answer: the answer');
    expect(failure.details).toContain('line 99');
    expect(failure.details).not.toContain('line 10');
  });

  test('says so when the run left no log', () => {
    expect(runFailure({ ...run }, '', null).details).toContain(
      'It left no log.'
    );
  });
});

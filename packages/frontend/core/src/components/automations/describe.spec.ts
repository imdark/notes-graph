import { describe, expect, test } from 'vitest';

import {
  ago,
  describeTrigger,
  newTrigger,
  showOutput,
  triggerProblem,
} from './describe';

describe('describeTrigger', () => {
  test('hooks say when they run and for whom', () => {
    const agent = (id: string) => (id === 'a1' ? 'Coder' : undefined);
    expect(describeTrigger({ type: 'hook', hook: 'end' }, { agent })).toBe(
      'After any agent ends'
    );
    expect(
      describeTrigger(
        {
          type: 'hook',
          hook: 'prestart',
          filter: { agentId: 'a1', deviceKey: 'mac' },
        },
        { agent }
      )
    ).toBe('Before Coder starts on mac');
    expect(
      describeTrigger({
        type: 'hook',
        hook: 'end',
        filter: { agentId: 'gone' },
      })
    ).toBe('After one agent ends');
  });

  test('schedules read as people say them', () => {
    expect(describeTrigger({ type: 'interval', minutes: 15 })).toBe(
      'Every 15 min'
    );
    expect(describeTrigger({ type: 'interval', minutes: 60 })).toBe(
      'Every hour'
    );
    expect(describeTrigger({ type: 'interval', minutes: 180 })).toBe(
      'Every 3 hours'
    );
    expect(describeTrigger({ type: 'cron', expr: '0 9 * * 1' })).toBe(
      'Cron 0 9 * * 1 (UTC)'
    );
    expect(describeTrigger({ type: 'event', event: 'monitor.reading' })).toBe(
      'When a monitor takes a reading'
    );
  });
});

describe('triggerProblem', () => {
  test('flags what the server would refuse', () => {
    expect(triggerProblem({ type: 'cron', expr: '0 9 *' })).toMatch(/five/);
    expect(triggerProblem({ type: 'interval', minutes: 0 })).toMatch(
      /1 minute/
    );
    expect(triggerProblem({ type: 'event', event: 'doc.updated' })).toMatch(
      /note/
    );
    expect(triggerProblem(newTrigger('cron'))).toBeNull();
    expect(triggerProblem(newTrigger('hook'))).toBeNull();
  });
});

test('ago and showOutput', () => {
  expect(ago(1000, 1000_000 + 30_000)).toBe('just now');
  expect(ago(0, 7200_000)).toBe('2h ago');
  expect(showOutput({ a: 1 })).toBe('{\n  "a": 1\n}');
  expect(showOutput('text')).toBe('text');
  expect(showOutput(null)).toBe('');
});

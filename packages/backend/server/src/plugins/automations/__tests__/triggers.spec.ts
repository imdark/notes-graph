import test from 'ava';

import { parseJobKinds } from '../../../models/registry-job';
import {
  matchingTrigger,
  nextRunAt,
  parseTriggers,
  TriggerError,
} from '../triggers';

/** What can start an automation, and when a schedule fires next. */

test('a good list of triggers comes back cleaned', t => {
  t.deepEqual(
    parseTriggers([
      { type: 'cron', expr: ' 0 9 * * 1 ', tz: 'America/New_York' },
      { type: 'interval', minutes: '15' },
      { type: 'event', event: 'job.finished', filter: { agentId: 'a1', x: 1 } },
      { type: 'webhook', extra: true },
      { type: 'manual' },
    ]),
    [
      { type: 'cron', expr: '0 9 * * 1', tz: 'America/New_York' },
      { type: 'interval', minutes: 15 },
      { type: 'event', event: 'job.finished', filter: { agentId: 'a1' } },
      { type: 'webhook' },
      { type: 'manual' },
    ]
  );
  t.deepEqual(parseTriggers(undefined), []);
});

test('bad triggers say what is wrong', t => {
  const bad = (raw: unknown, message: RegExp) =>
    t.throws(() => parseTriggers(raw), { instanceOf: TriggerError, message });
  bad({ type: 'manual' }, /must be a list/);
  bad([{ type: 'cron', expr: 'not a cron' }], /bad cron/);
  bad([{ type: 'cron', expr: '* * * * * *' }], /at most once a minute/);
  bad([{ type: 'interval', minutes: 0 }], /at least 1 minute/);
  bad([{ type: 'event', event: 'doc.deleted' }], /event must be one of/);
  bad([{ type: 'event', event: 'doc.updated' }], /needs a docId/);
  bad([{ type: 'sometimes' }], /trigger type must be/);
  bad(
    Array.from({ length: 11 }, () => ({ type: 'manual' })),
    /at most 10 triggers/
  );
});

test('a six-field cron with a fixed second is allowed', t => {
  t.notThrows(() => parseTriggers([{ type: 'cron', expr: '0 */5 * * * *' }]));
});

test('the next run is the earliest schedule; other triggers have none', t => {
  const from = new Date('2026-10-23T10:00:30Z');
  t.deepEqual(
    nextRunAt(
      parseTriggers([
        { type: 'interval', minutes: 60 },
        { type: 'cron', expr: '15 10 * * *', tz: 'UTC' },
      ]),
      from
    ),
    new Date('2026-10-23T10:15:00Z')
  );
  t.deepEqual(
    nextRunAt(parseTriggers([{ type: 'interval', minutes: 5 }]), from),
    new Date('2026-10-23T10:05:30Z')
  );
  t.is(nextRunAt(parseTriggers([{ type: 'webhook' }]), from), null);
});

test('a cron runs in its own time zone', t => {
  const next = nextRunAt(
    parseTriggers([
      { type: 'cron', expr: '0 9 * * *', tz: 'America/New_York' },
    ]),
    new Date('2026-10-23T12:00:00Z')
  );
  // 9am in New York is 13:00 UTC while daylight saving lasts.
  t.deepEqual(next, new Date('2026-10-23T13:00:00Z'));
});

test('an event trigger matches only when every filter field agrees', t => {
  const triggers = parseTriggers([
    { type: 'event', event: 'job.finished', filter: { agentId: 'a1' } },
    { type: 'event', event: 'monitor.reading' },
  ]);
  t.truthy(matchingTrigger(triggers, 'job.finished', { agentId: 'a1' }));
  t.is(matchingTrigger(triggers, 'job.finished', { agentId: 'a2' }), null);
  t.truthy(matchingTrigger(triggers, 'monitor.reading', { monitorId: 'm' }));
  t.is(matchingTrigger(triggers, 'run.failed', { agentId: 'a1' }), null);
});

test('a claim asks for agent jobs unless it names known kinds', t => {
  t.deepEqual(parseJobKinds(undefined), ['agent']);
  t.deepEqual(parseJobKinds(['bogus']), ['agent']);
  t.deepEqual(parseJobKinds(['automation']), ['automation']);
  t.deepEqual(parseJobKinds(['automation', 'agent']), ['agent', 'automation']);
  t.deepEqual(parseJobKinds('automation'), ['agent']);
});

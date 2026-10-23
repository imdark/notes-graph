import test from 'ava';

import { endActions, FAIL_TASKS_TEMPLATE, prestartVerdict } from '../hooks';
import { hooksRun, parseTriggers } from '../triggers';

/** What a hook's return value means for the agent run it wraps. */

test('a prestart hook stops a run with false, or allow: false and a reason', t => {
  t.deepEqual(prestartVerdict(false), { allow: false, reason: 'not allowed' });
  t.deepEqual(prestartVerdict({ allow: false, reason: 'no ticket id' }), {
    allow: false,
    reason: 'no ticket id',
  });
});

test('anything else lets the run start, rewriting what it returns', t => {
  t.deepEqual(prestartVerdict(null), { allow: true });
  t.deepEqual(prestartVerdict(true), { allow: true });
  t.deepEqual(prestartVerdict([1]), { allow: true });
  t.deepEqual(
    prestartVerdict({ instructions: 'Do X carefully', context: '', extra: 1 }),
    { allow: true, instructions: 'Do X carefully', context: '' }
  );
  // Blank instructions would leave the agent nothing to do: kept as they were.
  t.deepEqual(prestartVerdict({ instructions: '  ' }), { allow: true });
});

test('an end hook fails a run or sets its tasks, its own tasks only', t => {
  const tasks = ['t1', 't2'];
  t.deepEqual(endActions({ status: 'error', error: 'no tests' }, tasks), {
    fail: 'no tests',
  });
  t.deepEqual(endActions({ tasks: 'FAILED' }, tasks), {
    tasks: { t1: 'FAILED', t2: 'FAILED' },
  });
  t.deepEqual(
    endActions({ tasks: { t1: '[X]', t9: 'DONE', t2: 'not a status' } }, tasks),
    { tasks: { t1: '[X]' } }
  );
  t.deepEqual(endActions('done', tasks), {});
});

test('the template marks a failed run’s in-progress tasks FAILED', async t => {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = (input: unknown) =>
    new AsyncFunction('input', FAIL_TASKS_TEMPLATE)(input);
  const tasks = { t1: '[-]', t2: '[X]', t3: 'QUEUED' };
  const failed = await run({ job: { status: 'error' }, tasks });
  t.deepEqual(endActions(failed, ['t1', 't2', 't3']), {
    tasks: { t1: 'FAILED' },
  });
  t.is(await run({ job: { status: 'done' }, tasks }), undefined);
});

test('hook triggers parse, and match runs by agent and device', t => {
  const triggers = parseTriggers([
    { type: 'hook', hook: 'prestart', filter: { agentId: 'a1' } },
    { type: 'hook', hook: 'end' },
  ]);
  t.deepEqual(triggers[0], {
    type: 'hook',
    hook: 'prestart',
    filter: { agentId: 'a1' },
  });
  t.true(hooksRun(triggers, 'prestart', { agentId: 'a1', deviceKey: 'mac' }));
  t.false(hooksRun(triggers, 'prestart', { agentId: 'a2', deviceKey: 'mac' }));
  t.true(hooksRun(triggers, 'end', { agentId: 'a2', deviceKey: 'mac' }));
  t.throws(() => parseTriggers([{ type: 'hook', hook: 'midway' }]), {
    message: /hook must be one of/,
  });
});

import test from 'ava';

import { AutomationService, PRESTART_GIVE_UP_MS } from '../service';

/**
 * Hooks around agent runs, end to end against an in-memory store: a held
 * job waits on its prestart hooks, and an end hook acts on a finished run.
 */

const hookAutomation = (id: string, hook: string, over: any = {}): any => ({
  id,
  workspaceId: 'ws',
  createdBy: 'u1',
  name: `Hook ${id}`,
  triggers: [{ type: 'hook', hook }],
  secrets: [],
  timeoutSeconds: 30,
  maxRetries: 0,
  enabled: true,
  lastRunAt: null,
  ...over,
});

const agentJob = (over: any = {}): any => ({
  id: 'agent-1',
  workspaceId: 'ws',
  agentId: 'ag',
  agentName: 'Coder',
  deviceKey: 'mac',
  model: null,
  title: 'Fix the bug',
  instructions: 'Fix it',
  context: '',
  docId: 'd1',
  blockId: 'b1',
  taskIds: ['t1', 't2'],
  status: 'held',
  result: null,
  error: null,
  steps: 0,
  costUsd: null,
  ...over,
});

function setup(automations: any[], job = agentJob()) {
  const runs: any[] = [];
  const calls: Record<string, any[]> = {
    released: [],
    failed: [],
    failedAfter: [],
    tasks: [],
  };
  let gate: any;
  const models: any = {
    automation: {
      get: async (_: string, id: string) =>
        automations.find(a => a.id === id) ?? null,
      findById: async (id: string) => automations.find(a => a.id === id),
      listWithHooks: async () => automations,
      listWithEventTriggers: async () => [],
      listDeployments: async () => [{ target: 'cloud', versionId: 'v1' }],
      getVersion: async (_: string, id: string) => ({ id, code: 'return 1' }),
      createRun: async (input: any) => {
        const run = {
          id: `r${runs.length + 1}`,
          status: 'queued',
          output: null,
          error: null,
          startedAt: null,
          ...input,
        };
        runs.push(run);
        return run;
      },
      updateRun: async (id: string, data: any) => {
        const run = runs.find(r => r.id === id);
        Object.assign(run, data);
        return run;
      },
      update: async () => {},
      findRunByJob: async (jobId: string) =>
        runs.find(r => r.jobId === jobId) ?? null,
      listHookRuns: async (hookJobId: string, hook: string) =>
        runs
          .filter(r => r.hookJobId === hookJobId && r.hook === hook)
          .map(r => ({
            ...r,
            automation: automations.find(a => a.id === r.automationId),
          })),
      listStalePrestartRuns: async (before: Date) =>
        runs.filter(
          r =>
            r.hook === 'prestart' &&
            ['queued', 'running'].includes(r.status) &&
            r.createdAt < before
        ),
    },
    registryJob: {
      get: async (_: string, id: string) =>
        id === job.id ? job : { log: '', startedAt: null },
    },
  };
  const jobs: any = {
    enqueueAutomation: async () => ({ id: `job-${runs.length}` }),
    releaseHeld: async (...args: any[]) => calls.released.push(args),
    failHeld: async (...args: any[]) => calls.failed.push(args),
    failAfterEnd: async (...args: any[]) => calls.failedAfter.push(args),
    setTaskStatuses: async (_job: any, statuses: any) => {
      calls.tasks.push(statuses);
      return Object.keys(statuses);
    },
  };
  const gates: any = { register: (g: any) => (gate = g) };
  const service = new AutomationService(models, jobs, gates);
  service.onModuleInit();

  /** The runner reports a hook run's job as ended with this output. */
  const finish = (run: any, output: unknown, status = 'done', error = null) =>
    service.onJobFinished({
      workspaceId: 'ws',
      jobId: run.jobId,
      agentId: run.automationId,
      deviceKey: 'cloud',
      kind: 'automation',
      status,
      result: output === undefined ? null : JSON.stringify(output),
      error,
    });
  return { service, gate: () => gate, runs, calls, finish, job };
}

test('a job waits for every prestart hook, then goes with their rewrites', async t => {
  const { gate, runs, calls, finish, job } = setup([
    hookAutomation('h1', 'prestart'),
    hookAutomation('h2', 'prestart'),
  ]);
  t.true(await gate().holds(job));
  await gate().start(job);
  t.is(runs.length, 2);
  t.like(runs[0], { hook: 'prestart', hookJobId: 'agent-1' });
  t.like(runs[0].input, { hook: 'prestart', job: { instructions: 'Fix it' } });

  await finish(runs[0], { instructions: 'Fix it, with a test' });
  t.is(calls.released.length, 0, 'the other hook has not ended');
  await finish(runs[1], null);
  t.is(calls.released.length, 1);
  t.deepEqual(calls.released[0].slice(0, 3), [
    'ws',
    'agent-1',
    { instructions: 'Fix it, with a test' },
  ]);
});

test('a hook that says no stops the run, with its reason', async t => {
  const { gate, runs, calls, finish, job } = setup([
    hookAutomation('h1', 'prestart'),
  ]);
  await gate().start(job);
  await finish(runs[0], { allow: false, reason: 'no ticket id' });
  t.is(calls.released.length, 0);
  t.deepEqual(calls.failed[0], [
    'ws',
    'agent-1',
    'Stopped by automation "Hook h1": no ticket id',
  ]);
});

test('a hook that fails stops the run too', async t => {
  const { gate, runs, calls, finish, job } = setup([
    hookAutomation('h1', 'prestart'),
  ]);
  await gate().start(job);
  await finish(runs[0], undefined, 'error', 'Timed out after 30s' as any);
  t.regex(calls.failed[0][2], /"Hook h1" timed out: Timed out after 30s/);
});

test('a failed hook with retries left is tried again before deciding', async t => {
  const { gate, runs, calls, finish, job } = setup([
    hookAutomation('h1', 'prestart', { maxRetries: 1 }),
  ]);
  await gate().start(job);
  await finish(runs[0], undefined, 'error', 'flaky' as any);
  t.is(calls.failed.length, 0);
  t.is(runs.length, 2);
  t.like(runs[1], { attempt: 2, hook: 'prestart', hookJobId: 'agent-1' });
  await finish(runs[1], true);
  t.is(calls.released.length, 1);
});

test('only matching runs are held, and never a health check', async t => {
  const { gate } = setup([
    hookAutomation('h1', 'prestart', {
      triggers: [{ type: 'hook', hook: 'prestart', filter: { agentId: 'x' } }],
    }),
    hookAutomation('h2', 'end'),
  ]);
  t.false(
    await gate().holds({ workspaceId: 'ws', agentId: 'ag', deviceKey: 'mac' })
  );
  t.true(
    await gate().holds({ workspaceId: 'ws', agentId: 'x', deviceKey: 'mac' })
  );
  const health = setup([hookAutomation('h1', 'prestart')]);
  t.false(
    await health
      .gate()
      .holds({ workspaceId: 'ws', agentId: 'health:mac', deviceKey: 'mac' })
  );
});

test('a prestart hook nobody runs is given up on, stopping the run', async t => {
  const { service, gate, runs, calls, job } = setup([
    hookAutomation('h1', 'prestart'),
  ]);
  await gate().start(job);
  runs[0].createdAt = new Date(Date.now() - PRESTART_GIVE_UP_MS - 1000);
  await service.giveUpStalePrestart();
  t.is(runs[0].status, 'timed_out');
  t.regex(calls.failed[0][2], /timed out: No runner finished it in time/);
});

test('an end hook gets the run and its tasks, and can mark them failed', async t => {
  const { service, runs, calls, finish } = setup(
    [hookAutomation('h1', 'end')],
    agentJob({ status: 'error', error: 'crashed' })
  );
  await service.onJobFinished({
    workspaceId: 'ws',
    jobId: 'agent-1',
    agentId: 'ag',
    deviceKey: 'mac',
    kind: 'agent',
    status: 'error',
    result: null,
    error: 'crashed',
    taskStatuses: { t1: '[-]', t2: '[X]' },
  });
  t.is(runs.length, 1);
  t.like(runs[0].input, {
    hook: 'end',
    job: { status: 'error', error: 'crashed' },
    tasks: { t1: '[-]', t2: '[X]' },
  });
  await finish(runs[0], { tasks: { t1: 'FAILED' } });
  t.deepEqual(calls.tasks, [{ t1: 'FAILED' }]);
  t.is(calls.failedAfter.length, 0);
});

test('an end hook can fail a run that ended done', async t => {
  const { service, runs, calls, finish } = setup(
    [hookAutomation('h1', 'end')],
    agentJob({ status: 'done', result: 'All good' })
  );
  await service.onJobFinished({
    workspaceId: 'ws',
    jobId: 'agent-1',
    agentId: 'ag',
    deviceKey: 'mac',
    kind: 'agent',
    status: 'done',
    result: 'All good',
    error: null,
  });
  await finish(runs[0], { status: 'error', error: 'no tests were added' });
  t.deepEqual(calls.failedAfter[0], [
    'ws',
    'agent-1',
    'Failed by automation "Hook h1": no tests were added',
  ]);
});

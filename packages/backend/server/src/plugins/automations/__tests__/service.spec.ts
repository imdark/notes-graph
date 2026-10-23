import test from 'ava';

import {
  AutomationService,
  DOC_UPDATED_DEBOUNCE_MS,
  parseOutput,
  runStatus,
} from '../service';

/** Starting runs, picking up their results, and starting on events. */

const automationRow = (over: Record<string, unknown> = {}): any => ({
  id: 'a1',
  workspaceId: 'ws',
  createdBy: 'u1',
  name: 'Nightly',
  triggers: [{ type: 'manual' }],
  secrets: ['API_KEY'],
  timeoutSeconds: 30,
  maxRetries: 0,
  enabled: true,
  lastRunAt: null,
  ...over,
});

function setup(
  options: {
    automation?: any;
    deployments?: any[];
    run?: any;
    enqueueFails?: boolean;
  } = {}
) {
  const runs: any[] = [];
  const runUpdates: any[] = [];
  const queued: any[] = [];
  const automationUpdates: any[] = [];
  const automation = options.automation ?? automationRow();
  const models: any = {
    automation: {
      get: async () => automation,
      listDeployments: async () =>
        options.deployments ?? [{ target: 'mac', versionId: 'v1' }],
      getVersion: async (_: string, id: string) => ({ id, code: 'return 1' }),
      createRun: async (input: any) => {
        runs.push(input);
        return { id: `r${runs.length}`, ...input };
      },
      updateRun: async (id: string, data: any) => {
        runUpdates.push({ id, ...data });
        return { id, ...data };
      },
      update: async (id: string, data: any) =>
        automationUpdates.push({ id, ...data }),
      findRunByJob: async () => options.run ?? null,
      listWithEventTriggers: async () => [automation],
    },
    registryJob: {
      get: async () => ({ log: 'hello\n', startedAt: new Date(0) }),
    },
  };
  const jobs: any = {
    enqueueAutomation: async (...args: any[]) => {
      if (options.enqueueFails) throw new Error('device is offline');
      queued.push(args);
      return { id: `job-${queued.length}` };
    },
  };
  const service = new AutomationService(models, jobs);
  return { service, runs, runUpdates, queued, automationUpdates };
}

test('a run goes to the deployed device with its code and secret names', async t => {
  const { service, runs, queued } = setup();
  const run = await service.start(
    automationRow(),
    { type: 'manual' },
    { x: 1 }
  );
  t.is(run.jobId, 'job-1');
  t.is(runs[0].target, 'mac');
  const [workspaceId, userId, device, , payload] = queued[0];
  t.deepEqual([workspaceId, userId, device], ['ws', 'u1', 'mac']);
  t.like(payload, {
    runId: 'r1',
    code: 'return 1',
    input: { x: 1 },
    timeoutSeconds: 30,
    secrets: ['API_KEY'],
  });
});

test('nothing deployed: the run is refused', async t => {
  const { service } = setup({ deployments: [] });
  await t.throwsAsync(service.start(automationRow(), { type: 'manual' }), {
    message: /isn't deployed anywhere/,
  });
});

test('a run that never reached a device says why', async t => {
  const { service, runUpdates } = setup({ enqueueFails: true });
  await t.throwsAsync(service.start(automationRow(), { type: 'manual' }));
  t.like(runUpdates[0], { status: 'failed', error: 'device is offline' });
});

test('a finished job lands on its run, with output and logs', async t => {
  const { service, runUpdates } = setup({
    run: { id: 'r9', attempt: 1, automationId: 'a1', startedAt: null },
  });
  await service.onJobFinished({
    workspaceId: 'ws',
    jobId: 'job-1',
    agentId: 'a1',
    deviceKey: 'mac',
    kind: 'automation',
    status: 'done',
    result: '{"count":3}',
    error: null,
  });
  t.like(runUpdates[0], {
    id: 'r9',
    status: 'succeeded',
    output: { count: 3 },
    logs: 'hello\n',
  });
});

test('a failed run is retried while attempts remain', async t => {
  const { service, queued, runs } = setup({
    automation: automationRow({ maxRetries: 1 }),
    run: {
      id: 'r9',
      attempt: 1,
      automationId: 'a1',
      target: 'mac',
      trigger: { type: 'cron' },
      input: null,
    },
  });
  await service.onJobFinished({
    workspaceId: 'ws',
    jobId: 'job-1',
    agentId: 'a1',
    deviceKey: 'mac',
    kind: 'automation',
    status: 'error',
    result: null,
    error: 'boom',
  });
  t.is(queued.length, 1);
  t.is(runs[0].attempt, 2);
});

test('an agent job finishing starts the automations listening for it', async t => {
  const { service, queued, runs } = setup({
    automation: automationRow({
      triggers: [
        { type: 'event', event: 'job.finished', filter: { agentId: 'ag' } },
      ],
    }),
  });
  const event = {
    workspaceId: 'ws',
    jobId: 'job-7',
    agentId: 'ag',
    deviceKey: 'mac',
    kind: 'agent',
    status: 'done',
    result: 'ok',
    error: null,
  };
  await service.onJobFinished(event);
  t.is(queued.length, 1);
  t.like(runs[0], { trigger: { type: 'event', event: 'job.finished' } });
  await service.onJobFinished({ ...event, agentId: 'other' });
  t.is(queued.length, 1);
});

test('doc.updated starts a run at most once a minute', async t => {
  const triggers = [
    { type: 'event', event: 'doc.updated', filter: { docId: 'd1' } },
  ];
  const recent = setup({
    automation: automationRow({
      triggers,
      lastRunAt: new Date(Date.now() - DOC_UPDATED_DEBOUNCE_MS / 2),
    }),
  });
  await recent.service.onDocUpdated({ workspaceId: 'ws', docId: 'd1' });
  t.is(recent.queued.length, 0);

  const idle = setup({ automation: automationRow({ triggers }) });
  await idle.service.onDocUpdated({ workspaceId: 'ws', docId: 'd2' });
  t.is(idle.queued.length, 0);
  await idle.service.onDocUpdated({ workspaceId: 'ws', docId: 'd1' });
  t.is(idle.queued.length, 1);
});

test('job statuses map to run statuses', t => {
  t.is(runStatus('done', null), 'succeeded');
  t.is(runStatus('error', 'boom'), 'failed');
  t.is(runStatus('error', 'Timed out after 30s'), 'timed_out');
  t.is(runStatus('cancelled', null), 'cancelled');
});

test('output is JSON when it parses, text when it does not', t => {
  t.deepEqual(parseOutput('[1,2]'), [1, 2]);
  t.is(parseOutput('plain'), 'plain');
});

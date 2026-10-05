import test from 'ava';

import { agentInstructions, MAX_FAILURES, MonitorService } from '../service';

/**
 * Recording a reading, failing, and picking up a device job's result,
 * against stub models and writers.
 */

const monitorRow = (over: Record<string, unknown> = {}): any => ({
  id: 'm1',
  workspaceId: 'ws',
  createdBy: 'u1',
  name: 'EUR',
  docId: 'doc',
  blockId: 'blk',
  kind: 'check',
  source: 'url',
  deviceKey: null,
  spec: { url: 'https://example.com', extract: { type: 'number' } },
  intervalMinutes: 5,
  condition: { type: 'change' },
  alerts: { inApp: true },
  enabled: true,
  nextRunAt: new Date(),
  lastRunAt: null,
  lastValue: null,
  lastError: null,
  failureCount: 0,
  pendingJobId: null,
  ...over,
});

function setup(options: { canWrite?: boolean; monitor?: any } = {}) {
  const writes: any[] = [];
  const readings: any[] = [];
  const updates: any[] = [];
  const alerts: any[] = [];
  const pushes: any[] = [];
  const queued: any[] = [];
  const models: any = {
    monitor: {
      get: async () => options.monitor ?? null,
      findByPendingJob: async () => options.monitor ?? null,
      update: async (id: string, data: any) => updates.push({ id, ...data }),
      addReading: async (id: string, reading: any) => readings.push({ id, ...reading }),
    },
    doc: { getMeta: async () => ({ title: 'Rates' }) },
  };
  const writer: any = {
    updateBlock: async (...args: any[]) => writes.push(args),
  };
  const notifications: any = {
    createMonitorAlert: async (input: any, opts: any) => alerts.push({ input, opts }),
  };
  const ac: any = {
    user: () => ({
      workspace: () => ({ doc: () => ({ can: async () => options.canWrite ?? true }) }),
    }),
  };
  const jobs: any = {
    enqueue: async (...args: any[]) => {
      queued.push(args);
      return { id: 'job-1' };
    },
  };
  const queue: any = { add: async () => {} };
  const push: any = { monitorAlert: async (...args: any[]) => pushes.push(args) };
  const service = new MonitorService(models, writer, notifications, ac, jobs, queue, push);
  return { service, writes, readings, updates, alerts, pushes, queued };
}

test('a first reading is written to the block and kept, without alerting', async t => {
  const { service, writes, readings, updates, alerts } = setup();
  await service.record(monitorRow(), '0.92');
  t.is(writes.length, 1);
  const [ws, doc, block, line, editor, editorId] = writes[0];
  t.deepEqual([ws, doc, block, editor, editorId], ['ws', 'doc', 'blk', 'Monitor: EUR', 'u1']);
  t.true(line.startsWith('EUR: 0.92 · checked '));
  t.deepEqual(readings[0], { id: 'm1', value: '0.92', changed: false, alerted: false });
  t.is(updates.at(-1).lastValue, '0.92');
  t.is(alerts.length, 0);
});

test('a changed value alerts by the channels the monitor asks for', async t => {
  const { service, alerts, pushes, readings } = setup();
  await service.record(
    monitorRow({ lastValue: '0.91', alerts: { inApp: true, push: true, email: true } }),
    '0.92'
  );
  t.is(alerts.length, 1);
  t.true(alerts[0].opts.email);
  t.like(alerts[0].input.body, {
    monitorId: 'm1',
    value: '0.92',
    previous: '0.91',
    reason: 'changed',
    doc: { id: 'doc', blockId: 'blk', title: 'Rates' },
  });
  t.is(pushes.length, 1);
  t.true(readings[0].alerted);
});

test('a monitor set to alert nowhere only updates the block', async t => {
  const { service, alerts, pushes } = setup();
  await service.record(monitorRow({ lastValue: '1', alerts: {} }), '2');
  t.is(alerts.length + pushes.length, 0);
});

test('losing edit access to the note fails the run instead of writing', async t => {
  const { service, writes } = setup({ canWrite: false });
  await t.throwsAsync(service.record(monitorRow(), '1'), { message: /edit access/ });
  t.is(writes.length, 0);
});

test(`a url monitor pauses itself after ${MAX_FAILURES} failures in a row`, async t => {
  const monitor = monitorRow({
    failureCount: MAX_FAILURES - 1,
    spec: { url: 'not a url' },
    alerts: {},
  });
  const { service, updates, alerts } = setup({ monitor });
  await service.run({ monitorId: 'm1' });
  const last = updates.at(-1);
  t.is(last.enabled, false);
  t.is(last.failureCount, MAX_FAILURES);
  t.regex(last.lastError, /http/);
  // Paused monitors always say so in the bell, even with alerts off.
  t.is(alerts.length, 1);
  t.regex(alerts[0].input.body.reason, /paused/);
});

test('a command check queues a device job and waits for it', async t => {
  const monitor = monitorRow({
    source: 'command',
    deviceKey: 'mac',
    spec: { command: 'echo 42', extract: { type: 'number' } },
  });
  const { service, queued, updates } = setup({ monitor });
  await service.run({ monitorId: 'm1' });
  const [ws, user, device, body] = queued[0];
  t.deepEqual([ws, user, device], ['ws', 'u1', 'mac']);
  t.like(body, { model: 'command', instructions: 'echo 42', docId: 'doc', blockId: 'blk' });
  t.is(updates.at(-1).pendingJobId, 'job-1');
});

test('the device job’s output becomes the reading', async t => {
  const monitor = monitorRow({
    source: 'command',
    deviceKey: 'mac',
    pendingJobId: 'job-1',
    spec: { command: 'echo 42', extract: { type: 'number' } },
  });
  const { service, writes, updates } = setup({ monitor });
  await service.onJobFinished({
    workspaceId: 'ws',
    jobId: 'job-1',
    status: 'done',
    result: 'count 42\n',
    error: null,
  });
  t.is(updates[0].pendingJobId, null);
  t.true(writes[0][3].startsWith('EUR: 42'));
});

test('an agent run’s summary is the reading; the agent wrote the block itself', async t => {
  const monitor = monitorRow({ kind: 'agent', source: null, deviceKey: 'mac', pendingJobId: 'job-1' });
  const { service, writes, readings } = setup({ monitor });
  await service.onJobFinished({
    workspaceId: 'ws',
    jobId: 'job-1',
    status: 'done',
    result: 'RTX 5090 at $1,899 (Micro Center)',
    error: null,
  });
  t.is(writes.length, 0);
  t.is(readings[0].value, 'RTX 5090 at $1,899 (Micro Center)');
});

test('an agent is told which block to keep current', t => {
  const text = agentInstructions(
    { name: 'GPU deals', docId: 'doc', blockId: 'blk' },
    { instructions: 'Find RTX 5090 deals under $2,000.' }
  );
  t.true(text.startsWith('Find RTX 5090 deals'));
  t.regex(text, /block blk in doc doc/);
  t.regex(text, /update_block/);
});

test('validate refuses a check that runs too often or has no URL', t => {
  const { service } = setup();
  t.throws(() =>
    service.validate({ kind: 'check', source: 'url', spec: { url: 'https://x' }, intervalMinutes: 1 })
  );
  t.throws(() =>
    service.validate({ kind: 'check', source: 'url', spec: {}, intervalMinutes: 10 })
  );
  t.throws(() =>
    service.validate({ kind: 'agent', spec: { instructions: 'x' }, deviceKey: 'mac', intervalMinutes: 30 })
  );
  t.notThrows(() =>
    service.validate({ kind: 'agent', spec: { instructions: 'x' }, deviceKey: 'mac', intervalMinutes: 60 })
  );
});

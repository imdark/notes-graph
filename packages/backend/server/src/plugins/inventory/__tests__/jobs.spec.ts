import test from 'ava';

import { InventoryJobService } from '../jobs';

/**
 * Dispatch rules, against a stub Models.
 *
 * The claim race is covered by the model's conditional update and belongs
 * in an integration test with a real database; what is checked here is that
 * a job cannot be queued onto a machine that never opted in, and that the
 * wire shape stays what the CLI and the GUI expect.
 */

const workspaceId = 'ws-1';
const userId = 'user-1';

function makeService(options: { device?: any } = {}) {
  const created: any[] = [];
  const models: any = {
    inventoryDevice: {
      get: async () => options.device ?? null,
    },
    inventoryJob: {
      create: async (input: any) => {
        const job = {
          id: 'job-1',
          ...input,
          status: 'queued',
          result: null,
          error: null,
          steps: 0,
          startedAt: null,
          finishedAt: null,
          createdAt: new Date(0),
        };
        created.push(job);
        return job;
      },
    },
  };
  return { service: new InventoryJobService(models), created };
}

const agentTarget = { key: 'laptop', agentTarget: true };

test('queues a job for an agent target', async t => {
  const { service } = makeService({ device: agentTarget });
  const job = await service.enqueue(workspaceId, userId, 'laptop', {
    agentId: 'a1',
    agentName: 'summarize',
    instructions: 'Summarize the repo',
    context: 'ctx',
  });

  t.is(job.status, 'queued');
  t.is(job.agentName, 'summarize');
  t.is(job.deviceKey, 'laptop');
});

test('refuses a device that is not an agent target', async t => {
  // Registering a machine is not consent to run code on it.
  const { service } = makeService({ device: { key: 'laptop', agentTarget: false } });
  await t.throwsAsync(
    service.enqueue(workspaceId, userId, 'laptop', { instructions: 'go' }),
    { message: /not an agent target/ }
  );
});

test('refuses an unknown device', async t => {
  const { service } = makeService();
  await t.throwsAsync(
    service.enqueue(workspaceId, userId, 'ghost', { instructions: 'go' }),
    { message: /No device 'ghost'/ }
  );
});

test('requires instructions', async t => {
  const { service } = makeService({ device: agentTarget });
  await t.throwsAsync(
    service.enqueue(workspaceId, userId, 'laptop', { context: 'ctx' }),
    { message: /instructions are required/ }
  );
});

test('rejects oversized instructions rather than storing them', async t => {
  const { service } = makeService({ device: agentTarget });
  await t.throwsAsync(
    service.enqueue(workspaceId, userId, 'laptop', {
      instructions: 'x'.repeat(20_001),
    }),
    { message: /exceed/ }
  );
});

test('rejects an unknown report status', async t => {
  const { service } = makeService({ device: agentTarget });
  await t.throwsAsync(
    service.report(workspaceId, 'job-1', { status: 'exploded' }),
    { message: /status must be one of/ }
  );
});

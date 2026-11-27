import test from 'ava';

import { RegistryJobService } from '../jobs';

/** A follow-up that carries on an ended run in that run's own session. */

const workspaceId = 'ws-1';
const jobs: Record<string, any> = {
  ended: { id: 'ended', workspaceId, deviceKey: 'laptop', status: 'error' },
  allowed: {
    id: 'allowed',
    workspaceId,
    deviceKey: 'laptop',
    status: 'done',
    createdBy: 'user-1',
    allowAllTools: true,
  },
  othersAllowed: {
    id: 'othersAllowed',
    workspaceId,
    deviceKey: 'laptop',
    status: 'done',
    createdBy: 'user-2',
    allowAllTools: true,
  },
  going: { id: 'going', workspaceId, deviceKey: 'laptop', status: 'running' },
  elsewhere: {
    id: 'elsewhere',
    workspaceId,
    deviceKey: 'desk',
    status: 'done',
  },
};

function makeService(deviceKey: string) {
  const created: any[] = [];
  const allowedAll: string[] = [];
  const models: any = {
    registryDevice: {
      get: async () => ({ key: deviceKey, agentTarget: true }),
    },
    userFeature: { has: async () => false },
    registryJob: {
      get: async (ws: string, id: string) =>
        ws === workspaceId ? (jobs[id] ?? null) : null,
      heldUntil: async () => null,
      getBudget: async () => null,
      spentSince: async () => 0,
      allowAllTools: async (id: string) => {
        allowedAll.push(id);
      },
      create: async (input: any) => {
        const job = {
          id: 'job-new',
          status: 'queued',
          ...input,
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
  const service = new RegistryJobService(models);
  const enqueue = (continues: unknown) =>
    service.enqueue(workspaceId, 'user-1', deviceKey, {
      agentId: 'a1',
      agentName: 'Claude Code',
      instructions: 'go on',
      context: 'Now add a test',
      model: 'claude-code',
      continues,
    });
  return { enqueue, created, allowedAll };
}

test('a follow-up of an ended run on the same device carries its job id to the runner', async t => {
  const { enqueue, created } = makeService('laptop');
  const job = await enqueue('ended');
  t.is(created[0].continues, 'ended');
  t.is(job.continues, 'ended');
});

test('a follow-up of a run that was given Allow all starts with Allow all', async t => {
  const { enqueue, allowedAll } = makeService('laptop');
  const job = await enqueue('allowed');
  t.deepEqual(allowedAll, ['job-new']);
  t.true(job.allowAllTools);
});

test("a follow-up asks again when the run had no Allow all, or was someone else's", async t => {
  const { enqueue, allowedAll } = makeService('laptop');
  t.falsy((await enqueue('ended')).allowAllTools);
  t.falsy((await enqueue('othersAllowed')).allowAllTools);
  t.falsy((await enqueue(undefined)).allowAllTools);
  t.deepEqual(allowedAll, []);
});

test('a fresh run continues nothing', async t => {
  const { enqueue, created } = makeService('laptop');
  const job = await enqueue(undefined);
  t.is(created[0].continues, null);
  t.is(job.continues, null);
});

test('refused: a run still going, another device, an unknown job, the cloud runner', async t => {
  const laptop = makeService('laptop');
  await t.throwsAsync(() => laptop.enqueue('going'), {
    message: /hasn't ended/,
  });
  await t.throwsAsync(() => laptop.enqueue('elsewhere'), {
    message: /ran on desk/,
  });
  await t.throwsAsync(() => laptop.enqueue('nope'), {
    message: /No job 'nope'/,
  });
  const cloud = makeService('cloud');
  await t.throwsAsync(() => cloud.enqueue('ended'), {
    message: /cloud runner can't resume/,
  });
  t.deepEqual([...laptop.created, ...cloud.created], []);
});

import test from 'ava';

import { RegistryJobService } from '../jobs';

/**
 * The lookups the audits needed: a job's recorded changes, every open
 * question across runs, running a job again, and how a device's runner is.
 */

const workspaceId = 'ws-1';
const device = {
  key: 'cloud',
  agentTarget: true,
  runnerSeenAt: new Date('2026-11-26T22:39:22Z'),
  runnerVersion: '3dfc3284',
  maxJobs: 2,
};

const finished = {
  id: 'job-old',
  workspaceId,
  kind: 'agent',
  deviceKey: 'cloud',
  agentId: 'klzk',
  agentName: 'cloud - do the work',
  instructions: 'work on task list',
  context: 'Note: 2026-11-25 ...',
  model: 'workflow',
  tools: ['read_document'],
  skills: null,
  maxSteps: 8,
  maxCostUsd: null,
  access: null,
  targetKind: 'block',
  docId: 'journal',
  blockId: 'todo-1',
  title: 'Add "Generate title" note action',
  taskIds: ['todo-1'],
  status: 'error',
  result: null,
  error: 'Stream closed',
  log: 'x'.repeat(10_000),
  changes: { git: { branch: 'cloud-147', patch: 'diff --git a/x b/x' } },
  createdAt: new Date(0),
};

function makeService() {
  const created: any[] = [];
  const listed: any[] = [];
  const models: any = {
    registryDevice: {
      get: async (_ws: string, key: string) =>
        key === 'cloud' ? device : null,
    },
    userFeature: { has: async () => false },
    registryJob: {
      get: async (ws: string, id: string) =>
        ws === workspaceId && id === finished.id ? finished : null,
      list: async (_ws: string, filter: any) => {
        listed.push(filter);
        return filter.status === 'running' ? [{}, {}] : [{}];
      },
      openQuestions: async () => [
        {
          id: 'q1',
          kind: 'permission',
          text: 'Allow Bash?',
          detail: null,
          options: [],
          attachments: [],
          answer: null,
          allowed: null,
          createdAt: new Date('2026-11-26T08:28:00Z'),
          answeredAt: null,
          job: {
            id: 'job-2',
            title: 'Let wf commands run',
            agentId: 'klzk',
            agentName: 'cloud',
            deviceKey: 'cloud',
            status: 'running',
            docId: 'journal',
            blockId: 'todo-2',
            createdAt: new Date('2026-11-26T08:28:00Z'),
          },
        },
      ],
      heldUntil: async () => null,
      getBudget: async () => null,
      spentSince: async () => 0,
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
          createdAt: new Date(1),
        };
        created.push(job);
        return job;
      },
    },
  };
  return { service: new RegistryJobService(models), created, listed };
}

test("changes gives a job's recorded work in full, patch included", async t => {
  const { service } = makeService();
  t.deepEqual(await service.changes(workspaceId, 'job-old'), finished.changes);
  await t.throwsAsync(() => service.changes(workspaceId, 'nope'));
});

test('open questions come with their job, whichever device or tab started it', async t => {
  const { service } = makeService();
  const [q] = await service.openQuestions(workspaceId);
  t.like(q, { id: 'q1', kind: 'permission', text: 'Allow Bash?' });
  t.like(q.job, { id: 'job-2', deviceKey: 'cloud', docId: 'journal' });
  t.is(q.job.createdAt, Date.parse('2026-11-26T08:28:00Z') / 1000);
});

test('rerun queues the run as it was asked for, as a new job on its device', async t => {
  const { service, created } = makeService();
  const job = await service.rerun(workspaceId, 'user-1', 'job-old');
  t.is(job.id, 'job-new');
  t.is(created.length, 1);
  t.like(created[0], {
    deviceKey: 'cloud',
    agentId: 'klzk',
    model: 'workflow',
    instructions: 'work on task list',
    context: 'Note: 2026-11-25 ...',
    docId: 'journal',
    blockId: 'todo-1',
  });
  // Nothing of how the old one went comes along.
  t.is(created[0].error, null);
  t.falsy(created[0].log);
  await t.throwsAsync(() => service.rerun(workspaceId, 'user-1', 'nope'));
});

test("a runner's status: when it last asked for work, its build, its load", async t => {
  const { service } = makeService();
  t.deepEqual(await service.runnerStatus(workspaceId, 'cloud'), {
    deviceKey: 'cloud',
    seenAt: Date.parse('2026-11-26T22:39:22Z') / 1000,
    version: '3dfc3284',
    maxJobs: 2,
    running: 2,
    queued: 1,
  });
  await t.throwsAsync(() => service.runnerStatus(workspaceId, 'laptop'));
});

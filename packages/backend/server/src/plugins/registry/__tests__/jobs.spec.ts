import test from 'ava';

import { logStamp, stampInnerLines } from '../../../models';
import { profileFor } from '../agent-profiles';
import {
  capChanges,
  MAX_CHANGES_BYTES,
  RegistryJobService,
  toJobDto,
} from '../jobs';
import { questionPushData } from '../push';

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

function makeService(
  options: { device?: any; heldUntil?: Date; budget?: number; spent?: number } = {}
) {
  const created: any[] = [];
  const allowedAll: string[] = [];
  const models: any = {
    registryDevice: {
      get: async () => options.device ?? null,
    },
    registryJob: {
      heldUntil: async () => options.heldUntil ?? null,
      getBudget: async () => options.budget ?? null,
      spentSince: async () => options.spent ?? 0,
      allowAllTools: async (jobId: string) => {
        allowedAll.push(jobId);
      },
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
  return { service: new RegistryJobService(models), created, allowedAll };
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

function storedJob(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'job-1',
    workspaceId,
    deviceKey: 'laptop',
    agentId: 'a1',
    agentName: 'summarize',
    instructions: 'go',
    context: '',
    model: null,
    tools: [],
    maxSteps: 8,
    targetKind: null,
    docId: null,
    blockId: null,
    status: 'running',
    result: null,
    error: null,
    steps: 0,
    log: '',
    logDropped: 0,
    tmuxSession: null,
    claimedBy: 'runner',
    allowAllTools: false,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(0),
    ...overrides,
  };
}

test('a single job carries its transcript from the requested offset', t => {
  const job = storedJob({ log: 'step 1\nstep 2\n' });
  const dto = toJobDto(job, { logFrom: 7 });
  t.is(dto.log, 'step 2\n');
  t.is(dto.logFrom, 7);
  t.is(dto.logEnd, 14);
});

test('offsets stay absolute after the head of the transcript is dropped', t => {
  // 100 characters were trimmed; what remains starts at offset 100.
  const job = storedJob({ log: 'tail text', logDropped: 100 });

  const caughtUp = toJobDto(job, { logFrom: 105 });
  t.is(caughtUp.log, 'text');
  t.is(caughtUp.logEnd, 109);

  // A viewer that fell behind the trim gets everything still kept, and is
  // told where it actually starts.
  const behind = toJobDto(job, { logFrom: 20 });
  t.is(behind.log, 'tail text');
  t.is(behind.logFrom, 100);
});

test('offsets count code points, matching what Postgres trims by', t => {
  const job = storedJob({ log: '✅ done 🎉 ok' });
  // 11 code points, but 13 UTF-16 units.
  const dto = toJobDto(job, { logFrom: 8 });
  t.is(dto.log, ' ok');
  t.is(dto.logEnd, 11);
});

test('listings leave the transcript out', t => {
  const dto = toJobDto(storedJob({ log: 'big transcript' }));
  t.is(dto.log, undefined);
});

test('a single-job read carries what the run changed; listings do not', t => {
  const changes = { notes: { created: [{ docId: 'd1', title: 'Findings' }] } };
  t.deepEqual(toJobDto(storedJob({ changes }), { logFrom: 0 }).changes, changes);
  t.is(toJobDto(storedJob({ changes })).changes, undefined);
  t.is(toJobDto(storedJob(), { logFrom: 0 }).changes, null);
});

test('a final report passes what the run changed to the model, capped', async t => {
  let received: any;
  const models: any = {
    registryJob: {
      report: async (_ws: string, _id: string, input: any) => {
        received = input;
        return storedJob({ status: 'done' });
      },
    },
  };
  const service = new RegistryJobService(models);
  const changes = {
    notes: { created: [{ docId: 'd1', title: 'Findings' }] },
    files: [{ path: 'a.ts', before: 'x', after: 'y' }],
    git: { base: 'b', head: 'h', commits: [], stat: [], patch: 'p'.repeat(MAX_CHANGES_BYTES), truncated: false },
  };
  await service.report(workspaceId, 'job-1', { status: 'done', result: 'ok', changes });

  // The patch is what goes when it is too big; the rest still says what changed.
  t.is(received.changes.git.patch, '');
  t.true(received.changes.git.truncated);
  t.deepEqual(received.changes.notes, changes.notes);
  t.deepEqual(received.changes.files, changes.files);
});

test('capChanges drops what is not an object', t => {
  t.is(capChanges('diff'), undefined);
  t.is(capChanges([1]), undefined);
  t.is(capChanges(null), undefined);
});

test('a report passes log text and the tmux session to the model', async t => {
  let received: any;
  const models: any = {
    registryJob: {
      report: async (_ws: string, _id: string, input: any) => {
        received = input;
        return storedJob({ tmuxSession: input.tmuxSession });
      },
    },
  };
  const service = new RegistryJobService(models);
  const job = await service.report(workspaceId, 'job-1', {
    status: 'running',
    logAppend: '→ read_file\n',
    tmuxSession: 'wf-job-1234abcd',
  });

  t.is(received.logAppend, '→ read_file\n');
  t.is(received.tmuxSession, 'wf-job-1234abcd');
  t.is(job?.tmuxSession, 'wf-job-1234abcd');
});

function questionService(job: any, question?: any, open: any[] = []) {
  const answered: any[] = [];
  const asked: any[] = [];
  const allowedAll: string[] = [];
  const kept: string[][] = [];
  const models: any = {
    registryJob: {
      get: async () => job,
      allowAllTools: async (_jobId: string, by: string, except: string[] = []) => {
        allowedAll.push(by);
        kept.push(except);
      },
      listQuestions: async () => open,
      ask: async (jobId: string, input: any) => (asked.push(input), {
        id: 'q1',
        jobId,
        ...input,
        answer: null,
        allowed: null,
        createdAt: new Date(0),
        answeredAt: null,
      }),
      getQuestion: async () => question ?? null,
      // Mirrors the model's conditional update: only an open question wins.
      answer: async (_jobId: string, _qid: string, input: any) => {
        if (question.answeredAt) return null;
        answered.push(input);
        return { ...question, ...input, answeredAt: new Date(1000) };
      },
    },
  };
  return { service: new RegistryJobService(models), answered, asked, allowedAll, kept };
}

const openQuestion = (overrides: Record<string, unknown> = {}) => ({
  id: 'q1',
  jobId: 'job-1',
  kind: 'question',
  text: 'Who is Cosmo, and how old?',
  detail: null,
  options: [],
  answer: null,
  allowed: null,
  createdAt: new Date(0),
  answeredAt: null,
  ...overrides,
});

test('a running job can ask its starter a question', async t => {
  const { service } = questionService(storedJob({ createdBy: userId }));
  const question = await service.ask(workspaceId, 'job-1', {
    text: 'Who is Cosmo, and how old?',
  });
  t.is(question.kind, 'question');
  t.is(question.text, 'Who is Cosmo, and how old?');
  t.is(question.answeredAt, null);
});

test('a question can offer choices to pick from', async t => {
  const { service } = questionService(storedJob({ createdBy: userId }));
  const question = await service.ask(workspaceId, 'job-1', {
    text: 'Open a PR to main?',
    options: ['  Yes, open the PR ', '', 'No, stop here', 'Yes, open the PR', 7],
  });
  t.deepEqual(question.options, ['Yes, open the PR', 'No, stop here', '7']);
});

test('a permission keeps no choices; it is allow or deny', async t => {
  const { service, asked } = questionService(storedJob({ createdBy: userId }));
  await service.ask(workspaceId, 'job-1', {
    kind: 'permission',
    text: 'Allow Bash?',
    options: ['maybe'],
  });
  t.deepEqual(asked[0].options, []);
});

test('a finished job cannot ask anything', async t => {
  const { service } = questionService(storedJob({ status: 'done' }));
  await t.throwsAsync(service.ask(workspaceId, 'job-1', { text: 'still there?' }), {
    message: /is done, not running/,
  });
});

test('only the person who started the run can answer it', async t => {
  // A permission answered by someone else would run a tool on the
  // starter's machine on a stranger's say-so.
  const { service, answered } = questionService(
    storedJob({ createdBy: userId }),
    openQuestion()
  );
  await t.throwsAsync(
    service.answer(workspaceId, 'job-1', 'q1', 'someone-else', { answer: 'x' }),
    { message: /Only the person who started this run/ }
  );
  t.deepEqual(answered, []);
});

test('the starter answers a question with text', async t => {
  const { service, answered } = questionService(
    storedJob({ createdBy: userId }),
    openQuestion()
  );
  const question = await service.answer(workspaceId, 'job-1', 'q1', userId, {
    answer: '  My son, 7  ',
  });
  t.deepEqual(answered, [{ answer: 'My son, 7' }]);
  t.is(question.answer, 'My son, 7');
});

test('a permission needs an explicit allow or deny', async t => {
  const { service, answered } = questionService(
    storedJob({ createdBy: userId }),
    openQuestion({ kind: 'permission', text: 'Run Bash?', detail: '{"command":"ls"}' })
  );
  await t.throwsAsync(
    service.answer(workspaceId, 'job-1', 'q1', userId, { answer: 'sure' }),
    { message: /allowed \(true or false\)/ }
  );
  await service.answer(workspaceId, 'job-1', 'q1', userId, { allowed: false });
  t.deepEqual(answered, [{ allowed: false, answer: undefined }]);
});

test('"Allow all" allows the permission and every later one in the run', async t => {
  const { service, answered, allowedAll } = questionService(
    storedJob({ createdBy: userId }),
    openQuestion({ kind: 'permission', text: 'Allow Bash?' })
  );
  await service.answer(workspaceId, 'job-1', 'q1', userId, {
    allowed: true,
    allowAll: true,
  });
  t.deepEqual(answered, [{ allowed: true, answer: undefined }]);
  t.deepEqual(allowedAll, [userId]);
});

test('"Allow all" cannot go with a deny', async t => {
  const { service, answered, allowedAll } = questionService(
    storedJob({ createdBy: userId }),
    openQuestion({ kind: 'permission', text: 'Allow Bash?' })
  );
  await t.throwsAsync(
    service.answer(workspaceId, 'job-1', 'q1', userId, {
      allowed: false,
      allowAll: true,
    }),
    { message: /allowAll only goes with allowed: true/ }
  );
  t.deepEqual(answered, []);
  t.deepEqual(allowedAll, []);
});

test('after "Allow all" a permission is recorded as allowed, not asked', async t => {
  const { service, asked } = questionService(
    storedJob({ createdBy: userId, allowAllTools: true })
  );
  await service.ask(workspaceId, 'job-1', { kind: 'permission', text: 'Allow Edit?' });
  // A plain question still waits for the person: "Allow all" covers tools only.
  await service.ask(workspaceId, 'job-1', { text: 'Who is Cosmo?' });
  t.is(asked[0].allowedBy, userId);
  t.false('allowedBy' in asked[1]);
});

test('"Allow all" can be set up front, while the run is still queued', async t => {
  const { service, allowedAll } = questionService(
    storedJob({ createdBy: userId, status: 'queued' })
  );
  const job = await service.allowAll(workspaceId, 'job-1', userId);
  t.true(job.allowAllTools);
  t.deepEqual(allowedAll, [userId]);
});

test('only the starter can allow all up front, and only before it ends', async t => {
  const { service, allowedAll } = questionService(
    storedJob({ createdBy: userId })
  );
  await t.throwsAsync(service.allowAll(workspaceId, 'job-1', 'someone-else'), {
    message: /Only the person who started this run/,
  });
  const ended = questionService(storedJob({ createdBy: userId, status: 'done' }));
  await t.throwsAsync(ended.service.allowAll(workspaceId, 'job-1', userId), {
    message: /nothing left to allow/,
  });
  t.deepEqual(allowedAll, []);
  t.deepEqual(ended.allowedAll, []);
});

test("the run's own tools are allowed without asking", async t => {
  const { service, asked } = questionService(storedJob({ createdBy: userId }));
  await service.ask(workspaceId, 'job-1', {
    kind: 'permission',
    text: 'Allow mcp__run__set_title?',
    detail: '{"title":"Pick a show"}',
  });
  await service.ask(workspaceId, 'job-1', { kind: 'permission', text: 'Allow Bash?' });
  t.is(asked[0].allowedBy, userId);
  t.false('allowedBy' in asked[1]);
});

test('a question is answered once', async t => {
  const { service } = questionService(
    storedJob({ createdBy: userId }),
    openQuestion({ answeredAt: new Date(5), answer: 'first' })
  );
  await t.throwsAsync(
    service.answer(workspaceId, 'job-1', 'q1', userId, { answer: 'second' }),
    { message: /already been answered/ }
  );
});

test('a single job carries its questions; a listing does not', t => {
  const questions = [openQuestion()] as any;
  t.is(toJobDto(storedJob(), { logFrom: 0, questions }).questions?.[0].text,
    'Who is Cosmo, and how old?');
  t.is(toJobDto(storedJob()).questions, undefined);
});

test('messages sent to a run travel apart from its questions', t => {
  const rows = [
    openQuestion(),
    openQuestion({ id: 's1', kind: 'steer', text: 'Use the staging DB' }),
    openQuestion({ id: 's2', kind: 'steer', text: 'Skip tests', answeredAt: new Date(2000) }),
  ] as any;
  const dto = toJobDto(storedJob(), { logFrom: 0, questions: rows });
  // Nothing that reads open questions may take a waiting message for one.
  t.deepEqual(dto.questions?.map(q => q.id), ['q1']);
  t.deepEqual(dto.steers, [
    { id: 's1', text: 'Use the staging DB', createdAt: 0, deliveredAt: null },
    { id: 's2', text: 'Skip tests', createdAt: 0, deliveredAt: 2 },
  ]);
});

function steerService(job: any, waiting: any[] = []) {
  const sent: string[] = [];
  let taken = 0;
  const models: any = {
    registryJob: {
      get: async () => job,
      getQuestion: async () => waiting[0] ?? null,
      steer: async (jobId: string, text: string) => (sent.push(text), {
        ...openQuestion({ id: 's1', jobId, kind: 'steer', text }),
      }),
      takeSteers: async () => {
        taken++;
        return waiting.splice(0).map(s => ({ id: s.id, text: s.text, createdAt: new Date(0) }));
      },
    },
  };
  return { service: new RegistryJobService(models), sent, takes: () => taken };
}

test('the starter can send a running job a new instruction', async t => {
  const { service, sent } = steerService(storedJob({ createdBy: userId }));
  const steer = await service.steer(workspaceId, 'job-1', userId, {
    text: '  Use the staging DB  ',
  });
  t.deepEqual(sent, ['Use the staging DB']);
  t.is(steer.deliveredAt, null);
});

test('only the starter can message a run, and only before it ends', async t => {
  const { service, sent } = steerService(storedJob({ createdBy: userId }));
  await t.throwsAsync(
    service.steer(workspaceId, 'job-1', 'someone-else', { text: 'x' }),
    { message: /Only the person who started this run/ }
  );
  await t.throwsAsync(service.steer(workspaceId, 'job-1', userId, { text: '  ' }), {
    message: /text is required/,
  });
  const ended = steerService(storedJob({ createdBy: userId, status: 'done' }));
  await t.throwsAsync(ended.service.steer(workspaceId, 'job-1', userId, { text: 'x' }), {
    message: /can't take a message/,
  });
  t.deepEqual(sent, []);
  t.deepEqual(ended.sent, []);
});

test('the runner takes waiting messages once, and none after the run ends', async t => {
  const waiting = [openQuestion({ id: 's1', kind: 'steer', text: 'Skip tests' })];
  const { service } = steerService(storedJob({ createdBy: userId }), waiting);
  const first = await service.takeSteers(workspaceId, 'job-1');
  t.deepEqual(first.steers.map(s => s.text), ['Skip tests']);
  t.deepEqual((await service.takeSteers(workspaceId, 'job-1')).steers, []);

  const ended = steerService(storedJob({ status: 'cancelled' }), [
    openQuestion({ id: 's2', kind: 'steer', text: 'too late' }),
  ]);
  const late = await ended.service.takeSteers(workspaceId, 'job-1');
  t.deepEqual(late, { steers: [], jobStatus: 'cancelled' });
  t.is(ended.takes(), 0);
});

test('a waiting message cannot be answered as if it were a question', async t => {
  const { service } = steerService(storedJob({ createdBy: userId }), [
    openQuestion({ id: 's1', kind: 'steer', text: 'Skip tests' }),
  ]);
  await t.throwsAsync(
    service.answer(workspaceId, 'job-1', 's1', userId, { answer: 'x' }),
    { message: /No question 's1'/ }
  );
});

function pushStub() {
  const asked: string[] = [];
  const closed: string[][] = [];
  const push: any = {
    questionAsked: async (_job: any, question: any) => {
      asked.push(question.id);
    },
    questionsClosed: async (_job: any, ids: string[]) => {
      closed.push(ids);
    },
  };
  return { push, asked, closed };
}

test("a question pushes to the starter's phone", async t => {
  const { push, asked } = pushStub();
  const { service } = questionService(storedJob({ createdBy: userId }));
  const withPush = new RegistryJobService((service as any).models, push);
  await withPush.ask(workspaceId, 'job-1', { text: 'Who is Cosmo?' });
  t.deepEqual(asked, ['q1']);
});

test('a permission already allowed by "Allow all" pushes nothing', async t => {
  const { push, asked } = pushStub();
  const { service } = questionService(
    storedJob({ createdBy: userId, allowAllTools: true })
  );
  const withPush = new RegistryJobService((service as any).models, push);
  await withPush.ask(workspaceId, 'job-1', { kind: 'permission', text: 'Allow Edit?' });
  t.deepEqual(asked, []);
});

test('answering takes the question off the other phones', async t => {
  const { push, closed } = pushStub();
  const { service } = questionService(
    storedJob({ createdBy: userId }),
    openQuestion({ kind: 'permission', text: 'Allow Bash?' })
  );
  const withPush = new RegistryJobService((service as any).models, push);
  await withPush.answer(workspaceId, 'job-1', 'q1', userId, {
    allowed: false,
    answer: 'use rg, not grep',
  });
  t.deepEqual(closed, [['q1']]);
});

test('a push that fails does not fail the ask', async t => {
  const push: any = {
    questionAsked: async () => {
      throw new Error('FCM down');
    },
  };
  const { service } = questionService(storedJob({ createdBy: userId }));
  const withPush = new RegistryJobService((service as any).models, push);
  const question = await withPush.ask(workspaceId, 'job-1', { text: 'still?' });
  t.is(question.id, 'q1');
});

test('push data fits FCM by giving up the tool input first', t => {
  const data = questionPushData(
    'https://app.notesgraph.com',
    { id: 'job-1', workspaceId, agentName: 'coder', docId: null },
    {
      id: 'q1',
      kind: 'permission',
      text: 'Allow Write?',
      detail: 'x'.repeat(100_000),
      options: [],
    }
  );
  t.is(data.type, 'agent-question');
  t.is(data.server, 'https://app.notesgraph.com');
  t.is(data.kind, 'permission');
  t.true(Buffer.byteLength(JSON.stringify(data)) <= 3_500);
  t.true(data.detail.length <= 1_200);
});

test('appended log text gets a stamp at each inner line start', t => {
  const stamp = logStamp(new Date('2026-10-03T12:00:00.000Z'));
  t.is(stamp, '[2026-10-03T12:00:00.000Z] ');
  // The first line's stamp depends on the stored log, so it is left to SQL;
  // a trailing newline starts no line yet and gets nothing.
  t.is(
    stampInnerLines('tail\n→ read_file\n\nok\n', stamp),
    'tail\n' + stamp + '→ read_file\n\n' + stamp + 'ok\n'
  );
});

test('a job asked for while its device is at the session limit waits too', async t => {
  const heldUntil = new Date('2026-10-05T22:01:00Z');
  const { service, created } = makeService({ device: agentTarget, heldUntil });
  const job = await service.enqueue(workspaceId, userId, 'laptop', {
    instructions: 'go',
  });
  t.is(created[0].runAfter, heldUntil);
  t.is(job.runAfter, heldUntil.getTime() / 1000);
});

function makeReportService() {
  const calls: Record<string, any[]> = { requeue: [], holdQueued: [], report: [] };
  const job = {
    id: 'job-1',
    deviceKey: 'laptop',
    status: 'running',
    tools: [],
    createdAt: new Date(0),
  };
  const models: any = {
    registryJob: {
      requeue: async (...args: any[]) => {
        calls.requeue.push(args);
        return { ...job, status: 'queued', runAfter: args[2] };
      },
      holdQueued: async (...args: any[]) => {
        calls.holdQueued.push(args);
        return 2;
      },
      report: async (...args: any[]) => {
        calls.report.push(args);
        return { ...job, ...args[2] };
      },
    },
  };
  return { service: new RegistryJobService(models), calls };
}

test('a run stopped by the session limit goes back in the queue', async t => {
  const { service, calls } = makeReportService();
  const reset = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
  const dto = await service.report(workspaceId, 'job-1', {
    status: 'error',
    error: `Claude AI usage limit reached|${reset}`,
    logAppend: 'partial',
  });

  t.is(dto?.status, 'queued');
  t.is(calls.report.length, 0);
  const [, , runAfter, log] = calls.requeue[0];
  // Just after the reset the message gave.
  t.is(runAfter.getTime(), reset * 1000 + 60_000);
  t.true(log.startsWith('partial\n⏸ Claude session limit reached'));
  // Everything else waiting for that device waits with it.
  t.deepEqual(calls.holdQueued[0], [workspaceId, 'laptop', runAfter]);
});

test('an ordinary failure is still a failure', async t => {
  const { service, calls } = makeReportService();
  const dto = await service.report(workspaceId, 'job-1', {
    status: 'error',
    error: 'error_max_turns',
  });
  t.is(dto?.status, 'error');
  t.is(calls.requeue.length, 0);
});

test('a claimed job carries how to run it, the same for every runner', async t => {
  const job = (model: string | null) => ({
    id: 'job-1',
    workspaceId,
    deviceKey: 'cloud',
    agentId: 'a1',
    agentName: 'research',
    instructions: 'Find RTX 5090 deals',
    context: '',
    model,
    tools: [],
    maxSteps: 8,
    status: 'running',
    createdAt: new Date(0),
  });
  const claimWith = (model: string | null) =>
    new RegistryJobService({
      registryJob: { claim: async () => job(model) },
    } as any).claim(workspaceId, 'cloud', 'runner');

  const research = await claimWith('research');
  t.deepEqual(research?.profile?.mcpServers, ['notesgraph', 'run', 'omniseek']);
  t.true(research?.profile?.allowedTools.includes('mcp__omniseek'));
  t.is(research?.profile?.workdir, 'job');
  t.regex(research?.profile?.systemPrompt ?? '', /mcp__run__ask_user[\s\S]*research run[\s\S]*gap ledger/);
  // OmniSeek's own method, from its repo, not a paraphrase of it.
  t.deepEqual(research?.profile?.skills.map(s => s.name), ['omniseek-investigate']);
  t.regex(research!.profile!.skills[0].url, /^https:\/\/raw\.githubusercontent\.com\/Battam1111\/omniseek\/.*\/SKILL\.md$/);

  const code = await claimWith('claude-code');
  t.deepEqual(code?.profile?.mcpServers, ['notesgraph', 'run']);
  t.is(code?.profile?.workdir, 'repo');
  t.false(code?.profile?.allowedTools.includes('mcp__omniseek'));
  // A code task works in its own worktree; tests and typechecks are tools.
  t.deepEqual(code?.profile?.automation.setup.map(s => s.name), ['mirror', 'worktree']);
  t.is(code?.profile?.automation.cwd, '{job_dir}/repo');
  t.deepEqual(
    code?.profile?.automation.tools.map(tool => tool.name),
    ['install_deps', 'run_tests', 'typecheck']
  );
  // Agent-supplied values reach a tool's command only as $ARG_*, never spliced in.
  for (const tool of code?.profile?.automation.tools ?? []) {
    for (const param of Object.keys(tool.params ?? {})) {
      t.true(tool.run.includes(`"$ARG_${param.toUpperCase()}"`), `${tool.name} quotes $ARG_${param}`);
      t.false(tool.run.includes(`{${param}}`));
    }
  }
  t.deepEqual(research?.profile?.automation.tools.map(tool => tool.name), ['fetch_source']);

  // antislop, pinned to a release, with its terminal-only steps settled up front.
  t.deepEqual(code?.profile?.skills.map(s => s.name), [
    'antislop',
    'antislop-ui',
    'antislop-copywriting',
    'antislop-human',
    'antislop-layoutmobile',
    'antislop-code',
  ]);
  for (const skill of code?.profile?.skills ?? []) {
    t.regex(
      skill.url,
      new RegExp(`^https://raw\\.githubusercontent\\.com/miqdadbadjuber/anti-slop/[0-9a-f]{40}/skills/${skill.name}/SKILL\\.md$`)
    );
  }
  t.regex(code?.profile?.systemPrompt ?? '', /Skip its First-Run Install Wizard[\s\S]*"during"/);
  // Research reads the world; it doesn't build UI.
  t.false(research?.profile?.systemPrompt.includes('antislop'));

  // A Workflow job is a wf task in the runner's own CLOUD project.
  const workflow = await claimWith('workflow');
  t.is(workflow?.profile?.systemPrompt, code?.profile?.systemPrompt);
  t.deepEqual(workflow?.profile?.automation.setup.map(s => s.name), ['checkout', 'wf project', 'task']);
  t.regex(workflow!.profile!.automation.setup[1].run, /name: CLOUD/);
  t.regex(
    workflow!.profile!.automation.setup[2].run,
    /^wf agent prepare-task .*--prompt-file \{prompt_file\} --out \{job_dir\}\/automation\.json$/
  );

  t.is((await claimWith('command'))?.profile, null, 'not a Claude agent');
  t.is((await claimWith(null))?.profile, null);
});

/** Records which of the job's task claims ran, and on what. */
function fakeTasks() {
  const calls: { op: string; job: any }[] = [];
  const tasks: any = {
    queued: async (job: any) => calls.push({ op: 'queued', job }),
    claimed: async (job: any) => calls.push({ op: 'claimed', job }),
    finished: async (job: any) => calls.push({ op: 'finished', job }),
  };
  return { tasks, calls };
}

test('a job on tasks marks them queued when it is asked for', async t => {
  const { service } = makeService({ device: agentTarget });
  const { tasks, calls } = fakeTasks();
  const withTasks = new RegistryJobService(
    (service as any).models, undefined, undefined, tasks
  );
  const job = await withTasks.enqueue(workspaceId, userId, 'laptop', {
    instructions: 'work the list',
    docId: 'doc-1',
    taskIds: ['t1', 't2', 't1', 7, ''],
  });

  t.deepEqual(job.taskIds, ['t1', 't2']);
  t.deepEqual(calls.map(c => c.op), ['queued']);
  t.deepEqual(calls[0].job.taskIds, ['t1', 't2']);
});

test('tasks without a note to find them in are dropped', async t => {
  const { service, created } = makeService({ device: agentTarget });
  await service.enqueue(workspaceId, userId, 'laptop', {
    instructions: 'go',
    taskIds: ['t1'],
  });
  t.deepEqual(created[0].taskIds, []);
});

test('claiming a job starts its tasks', async t => {
  const { tasks, calls } = fakeTasks();
  const job = { id: 'job-1', workspaceId, model: null, tools: [], createdAt: new Date(0) };
  const service = new RegistryJobService(
    { registryJob: { claim: async () => job } } as any,
    undefined,
    undefined,
    tasks
  );
  await service.claim(workspaceId, 'laptop', 'runner');
  t.deepEqual(calls.map(c => c.op), ['claimed']);

  const none = new RegistryJobService(
    { registryJob: { claim: async () => null } } as any,
    undefined,
    undefined,
    tasks
  );
  t.is(await none.claim(workspaceId, 'laptop', 'runner'), null);
  t.is(calls.length, 1);
});

test('a job that ends, however it ends, hands its tasks back', async t => {
  for (const status of ['done', 'error']) {
    const { service: base } = makeReportService();
    const { tasks, calls } = fakeTasks();
    const service = new RegistryJobService(
      (base as any).models, undefined, undefined, tasks
    );
    await service.report(workspaceId, 'job-1', { status, error: 'boom' });
    t.deepEqual(calls.map(c => c.op), ['finished'], status);
  }

  // Still going: nothing to hand back yet.
  const { service: base } = makeReportService();
  const { tasks, calls } = fakeTasks();
  const service = new RegistryJobService(
    (base as any).models, undefined, undefined, tasks
  );
  await service.report(workspaceId, 'job-1', { status: 'running', steps: 2 });
  t.deepEqual(calls, []);
});

test('a cancelled job hands its tasks back', async t => {
  const { tasks, calls } = fakeTasks();
  const job = { id: 'job-1', status: 'cancelled', tools: [], createdAt: new Date(0) };
  const service = new RegistryJobService(
    { registryJob: { cancel: async () => job } } as any,
    undefined,
    undefined,
    tasks
  );
  await service.cancel(workspaceId, 'job-1');
  t.deepEqual(calls.map(c => c.op), ['finished']);
});

/** A service over one stored job, recording lost-runner notes it writes. */
function lostRunnerService(job: any) {
  const notes: { lease: Date; marker: string; note: string }[] = [];
  let row = job;
  const models: any = {
    registryDevice: { get: async () => null },
    registryJob: {
      get: async () => row,
      listQuestions: async () => [],
      noteLeaseLapsed: async (_id: string, lease: Date, marker: string, note: string) => {
        // Once per lapse, as the model's guarded update does it.
        if (row.log.includes(marker)) return false;
        notes.push({ lease, marker, note });
        row = { ...row, log: row.log + note };
        return true;
      },
    },
  };
  return { service: new RegistryJobService(models), notes };
}

test('a run whose runner stopped reporting says so in its log', async t => {
  const lease = new Date(Date.now() - 10 * 60_000);
  const { service, notes } = lostRunnerService(
    storedJob({ claimedBy: 'mac-1', leaseExpiresAt: lease })
  );

  const job = await service.get(workspaceId, 'job-1', 0);

  t.is(notes.length, 1);
  t.regex(job!.log!, /Lost contact with laptop/);
  t.regex(job!.log!, /mac-1/);
  t.true(job!.log!.includes(lease.toISOString()));
  t.is(job!.status, 'running');
  t.is(job!.leaseExpiresAt, lease.getTime() / 1000);

  // Polling again doesn't repeat it.
  await service.get(workspaceId, 'job-1', 0);
  t.is(notes.length, 1);
});

test('the lost-runner note goes on its own line', async t => {
  const { service, notes } = lostRunnerService(
    storedJob({ log: 'cloning…', leaseExpiresAt: new Date(Date.now() - 10 * 60_000) })
  );
  await service.get(workspaceId, 'job-1', 0);
  t.true(notes[0].note.startsWith('\n⚠'));
  t.true(notes[0].note.endsWith('\n'));
});

test('a runner only just late, or a job not running, gets no note', async t => {
  for (const job of [
    storedJob({ leaseExpiresAt: new Date(Date.now() - 5_000) }),
    storedJob({ leaseExpiresAt: new Date(Date.now() + 60_000) }),
    storedJob({ status: 'done', leaseExpiresAt: null }),
    storedJob({ status: 'queued', leaseExpiresAt: null }),
  ]) {
    const { service, notes } = lostRunnerService(job);
    await service.get(workspaceId, 'job-1', 0);
    t.is(notes.length, 0);
  }
});

/** A service over one queued job and its device, recording unclaimed notes. */
function unclaimedService(job: any, device: any) {
  const notes: string[] = [];
  let row = job;
  const models: any = {
    registryDevice: { get: async () => device },
    registryJob: {
      get: async () => row,
      listQuestions: async () => [],
      noteUnclaimed: async (_id: string, marker: string, note: string) => {
        if (row.log.includes(marker)) return false;
        notes.push(note);
        row = { ...row, log: row.log + note };
        return true;
      },
    },
  };
  return { service: new RegistryJobService(models), notes };
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

test('a queued run no runner is picking up says how to start one', async t => {
  const { service, notes } = unclaimedService(
    storedJob({ status: 'queued', createdAt: minutesAgo(5) }),
    { key: 'laptop', host: 'my-mac', runnerSeenAt: minutesAgo(30) }
  );

  const job = await service.get(workspaceId, 'job-1', 0);

  t.is(notes.length, 1);
  t.regex(job!.log!, /Nothing on laptop is picking up runs/);
  t.regex(job!.log!, /wf agent serve` on my-mac/);
  t.true(job!.log!.includes(minutesAgo(30).toISOString().slice(0, 13)));

  await service.get(workspaceId, 'job-1', 0);
  t.is(notes.length, 1);
});

test('a queued run is not flagged while its runner is listening or it is held', async t => {
  const cases: [any, any][] = [
    // Just queued: give a runner a moment.
    [storedJob({ status: 'queued', createdAt: minutesAgo(0.2) }), { runnerSeenAt: null }],
    // Runner asked for work a moment ago (it's busy, not gone).
    [storedJob({ status: 'queued', createdAt: minutesAgo(5) }), { runnerSeenAt: minutesAgo(0.5) }],
    // Held back to after a session limit on purpose.
    [
      storedJob({ status: 'queued', createdAt: minutesAgo(5), runAfter: new Date(Date.now() + 3_600_000) }),
      { runnerSeenAt: null },
    ],
    // The server's own cloud runner has no device row.
    [storedJob({ status: 'queued', createdAt: minutesAgo(5) }), null],
  ];
  for (const [job, device] of cases) {
    const { service, notes } = unclaimedService(job, device);
    await service.get(workspaceId, 'job-1', 0);
    t.is(notes.length, 0);
  }
});

test('asking for work marks the device as having a runner', async t => {
  const touched: string[] = [];
  const models: any = {
    registryDevice: { touchRunner: async (_ws: string, key: string) => void touched.push(key) },
    registryJob: { claim: async () => null },
  };
  const service = new RegistryJobService(models);
  t.is(await service.claim(workspaceId, 'laptop', 'mac-1'), null);
  t.deepEqual(touched, ['laptop']);
});

test('a job’s chosen skills replace the model’s defaults, catalog names only', t => {
  const defaults = profileFor('claude-code')!;
  t.true(defaults.skills.length > 1);
  const chosen = profileFor('claude-code', ['antislop-ui', 'not-a-skill']);
  t.deepEqual(chosen?.skills.map(s => s.name), ['antislop-ui']);
  t.deepEqual(profileFor('claude-code', [])?.skills, []);
  t.is(profileFor('some-other-model', ['antislop']), null);
});

test('a run is refused once the month has used the budget', async t => {
  const { service, created } = makeService({ device: agentTarget, budget: 20, spent: 20.5 });
  await t.throwsAsync(
    service.enqueue(workspaceId, userId, 'laptop', { instructions: 'go' }),
    { message: /used their \$20\.00 budget for \d{4}-\d{2} \(\$20\.50 spent\)/ }
  );
  t.deepEqual(created, []);

  const under = makeService({ device: agentTarget, budget: 20, spent: 19.99 });
  await under.service.enqueue(workspaceId, userId, 'laptop', { instructions: 'go' });
  t.is(under.created.length, 1);
});

test('a spend report lists ended runs with their claim-to-end time', async t => {
  const { service } = makeService();
  let asked: any;
  service['models'].registryJob.endedSince = async (...args: any[]) => {
    asked = args;
    return [
      {
        docId: 'doc-1',
        status: 'done',
        createdAt: new Date('2026-10-14T10:00:00Z'),
        startedAt: new Date('2026-10-14T10:01:00Z'),
        finishedAt: new Date('2026-10-14T10:06:00Z'),
        costUsd: 0.42,
        tokens: 1200,
      },
      {
        docId: null,
        status: 'cancelled',
        createdAt: new Date('2026-10-14T11:00:00Z'),
        startedAt: null,
        finishedAt: new Date('2026-10-14T11:02:00Z'),
        costUsd: null,
        tokens: null,
      },
    ];
  };
  const report = await service.spend(workspaceId, 9999);

  t.is(asked[0], workspaceId);
  // The window is capped, however many days are asked for.
  t.true(Date.now() - asked[1].getTime() <= 120 * 24 * 60 * 60 * 1000 + 1000);
  t.deepEqual(report.runs, [
    {
      docId: 'doc-1',
      status: 'done',
      createdAt: '2026-10-14T10:00:00.000Z',
      durationMs: 300_000,
      costUsd: 0.42,
      tokens: 1200,
    },
    {
      docId: null,
      status: 'cancelled',
      createdAt: '2026-10-14T11:00:00.000Z',
      durationMs: null,
      costUsd: null,
      tokens: null,
    },
  ]);
});

test('a job carries its cost cap and level; full access allows all from the start', async t => {
  const { service, created, allowedAll } = makeService({ device: agentTarget });
  const job = await service.enqueue(workspaceId, userId, 'laptop', {
    instructions: 'go',
    maxCostUsd: '2.5',
    access: 'full',
  });
  t.is(created[0].maxCostUsd, 2.5);
  t.is(created[0].access, 'full');
  t.deepEqual(allowedAll, ['job-1']);
  t.true(job.allowAllTools);

  const plain = makeService({ device: agentTarget });
  await plain.service.enqueue(workspaceId, userId, 'laptop', {
    instructions: 'go',
    maxCostUsd: -1,
    access: 'root',
  });
  t.is(plain.created[0].maxCostUsd, null);
  t.is(plain.created[0].access, null);
  t.deepEqual(plain.allowedAll, []);
});

test('a report passes what the run cost to the model', async t => {
  let received: any;
  const models: any = {
    registryJob: {
      report: async (_ws: string, _id: string, input: any) => {
        received = input;
        return storedJob({ status: 'done', costUsd: input.costUsd, tokens: input.tokens });
      },
    },
  };
  const job = await new RegistryJobService(models).report(workspaceId, 'job-1', {
    status: 'done',
    costUsd: 0.4213,
    tokens: 1200.4,
  });
  t.is(received.costUsd, 0.4213);
  t.is(received.tokens, 1200);
  t.is(job?.costUsd, 0.4213);
});

test('a read-only run is refused a tool without anyone being asked', async t => {
  const { service, asked } = questionService(storedJob({ createdBy: userId, access: 'read' }));
  const question = await service.ask(workspaceId, 'job-1', {
    kind: 'permission',
    text: 'Allow mcp__notesgraph__update_document?',
  });
  t.regex(asked[0].refused, /can only read/);
  t.false('allowedBy' in asked[0]);
  t.is(question.kind, 'permission');
  // Its own tools and plain questions still go through.
  await service.ask(workspaceId, 'job-1', { kind: 'permission', text: 'Allow mcp__run__set_title?' });
  await service.ask(workspaceId, 'job-1', { text: 'Which topic?' });
  t.false('refused' in asked[1]);
  t.false('refused' in asked[2]);
});

test('"Allow all" does not cover deploying, spending or deleting', async t => {
  const { service, asked } = questionService(
    storedJob({ createdBy: userId, allowAllTools: true })
  );
  await service.ask(workspaceId, 'job-1', {
    kind: 'permission',
    text: 'Allow Bash?',
    detail: JSON.stringify({ command: 'scripts/deploy-bg.sh' }),
  });
  await service.ask(workspaceId, 'job-1', {
    kind: 'permission',
    text: 'Allow Bash?',
    detail: JSON.stringify({ command: 'git push -u origin feat/x' }),
  });
  t.false('allowedBy' in asked[0]);
  t.is(asked[1].allowedBy, userId);
});

test('pressing "Allow all" leaves an open deploy waiting', async t => {
  const deploy = openQuestion({
    id: 'q2',
    kind: 'permission',
    text: 'Allow Bash?',
    detail: JSON.stringify({ command: 'fly deploy' }),
  });
  const { service, kept } = questionService(
    storedJob({ createdBy: userId }),
    openQuestion({ kind: 'permission', text: 'Allow Edit?' }),
    [deploy]
  );
  await service.answer(workspaceId, 'job-1', 'q1', userId, { allowed: true, allowAll: true });
  t.deepEqual(kept, [['q2']]);
});

/** A service whose model's report returns `after`, with a push and task stub. */
function reportService(after: any, taskStatuses: Record<string, string> = {}) {
  const finished: Array<{ job: any; statuses: Record<string, string> }> = [];
  const models: any = {
    registryJob: { report: async () => after },
  };
  const push: any = {
    runFinished: async (job: any, statuses: Record<string, string>) => {
      finished.push({ job, statuses });
    },
  };
  const tasks: any = { finished: async () => taskStatuses };
  return { service: new RegistryJobService(models, push, undefined, tasks), finished };
}

test("a run's end pushes where its tasks ended", async t => {
  const { service, finished } = reportService(
    storedJob({ createdBy: userId, status: 'done', result: 'PR #1' }),
    { b1: 'COMMITTED' }
  );
  await service.report(workspaceId, 'job-1', { status: 'done', result: 'PR #1' });
  await new Promise(resolve => setImmediate(resolve));
  t.is(finished.length, 1);
  t.deepEqual(finished[0].statuses, { b1: 'COMMITTED' });
});

test('a late report on a cancelled run pushes nothing', async t => {
  const { service, finished } = reportService(
    storedJob({ createdBy: userId, status: 'cancelled' })
  );
  await service.report(workspaceId, 'job-1', { status: 'done', result: 'too late' });
  await new Promise(resolve => setImmediate(resolve));
  t.is(finished.length, 0);
});

test('a running report pushes nothing', async t => {
  const { service, finished } = reportService(storedJob({ createdBy: userId }));
  await service.report(workspaceId, 'job-1', { status: 'running', logAppend: 'x' });
  t.is(finished.length, 0);
});

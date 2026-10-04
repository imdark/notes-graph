import test from 'ava';

import { logStamp, stampInnerLines } from '../../../models';
import { InventoryJobService, toJobDto } from '../jobs';

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

test('a report passes log text and the tmux session to the model', async t => {
  let received: any;
  const models: any = {
    inventoryJob: {
      report: async (_ws: string, _id: string, input: any) => {
        received = input;
        return storedJob({ tmuxSession: input.tmuxSession });
      },
    },
  };
  const service = new InventoryJobService(models);
  const job = await service.report(workspaceId, 'job-1', {
    status: 'running',
    logAppend: '→ read_file\n',
    tmuxSession: 'wf-job-1234abcd',
  });

  t.is(received.logAppend, '→ read_file\n');
  t.is(received.tmuxSession, 'wf-job-1234abcd');
  t.is(job?.tmuxSession, 'wf-job-1234abcd');
});

function questionService(job: any, question?: any) {
  const answered: any[] = [];
  const asked: any[] = [];
  const allowedAll: string[] = [];
  const models: any = {
    inventoryJob: {
      get: async () => job,
      allowAllTools: async (_jobId: string, by: string) => {
        allowedAll.push(by);
      },
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
  return { service: new InventoryJobService(models), answered, asked, allowedAll };
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

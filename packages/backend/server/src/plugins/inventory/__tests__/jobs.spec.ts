import test from 'ava';

import { logStamp, stampInnerLines } from '../../../models';
import { InventoryJobService, toJobDto } from '../jobs';
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

function makeService(options: { device?: any; heldUntil?: Date } = {}) {
  const created: any[] = [];
  const models: any = {
    inventoryDevice: {
      get: async () => options.device ?? null,
    },
    inventoryJob: {
      heldUntil: async () => options.heldUntil ?? null,
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
  const withPush = new InventoryJobService((service as any).models, push);
  await withPush.ask(workspaceId, 'job-1', { text: 'Who is Cosmo?' });
  t.deepEqual(asked, ['q1']);
});

test('a permission already allowed by "Allow all" pushes nothing', async t => {
  const { push, asked } = pushStub();
  const { service } = questionService(
    storedJob({ createdBy: userId, allowAllTools: true })
  );
  const withPush = new InventoryJobService((service as any).models, push);
  await withPush.ask(workspaceId, 'job-1', { kind: 'permission', text: 'Allow Edit?' });
  t.deepEqual(asked, []);
});

test('answering takes the question off the other phones', async t => {
  const { push, closed } = pushStub();
  const { service } = questionService(
    storedJob({ createdBy: userId }),
    openQuestion({ kind: 'permission', text: 'Allow Bash?' })
  );
  const withPush = new InventoryJobService((service as any).models, push);
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
  const withPush = new InventoryJobService((service as any).models, push);
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
    inventoryJob: {
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
  return { service: new InventoryJobService(models), calls };
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
    new InventoryJobService({
      inventoryJob: { claim: async () => job(model) },
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

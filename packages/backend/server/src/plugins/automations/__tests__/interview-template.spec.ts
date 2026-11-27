import { runInNewContext } from 'node:vm';

import test from 'ava';

import { INTERVIEW_EVENTS_TEMPLATE } from '../interview-template';

type Call = { method: string; path: string; body: any };

/** Runs the template as the sandbox does, against a fake `notesgraph`. */
async function run(
  events: any[],
  docs: any[] = [],
  device = 'cloud',
  calendar = ''
) {
  const calls: Call[] = [];
  const code = INTERVIEW_EVENTS_TEMPLATE.replace(
    "const AGENT_DEVICE = 'cloud';",
    `const AGENT_DEVICE = '${device}';`
  ).replace("const CALENDAR = '';", `const CALENDAR = '${calendar}';`);
  const context = {
    console: { log: () => {} },
    notesgraph: {
      workspaceId: 'ws1',
      fetch: async (path: string, init: any = {}) => {
        const method = init.method ?? 'GET';
        calls.push({ method, path, body: init.body });
        if (path === '/graphql') {
          return {
            data: {
              workspace: {
                calendars: [
                  { displayNameOverride: 'Pantheon', enabled: true, events },
                  {
                    displayNameOverride: 'Personal',
                    enabled: true,
                    events: [
                      {
                        externalEventId: 'x',
                        title: 'Interview',
                        startAtUtc: '',
                        endAtUtc: '',
                      },
                    ],
                  },
                ],
              },
            },
          };
        }
        if (path.includes('/devices/')) return { job: { id: 'job1' } };
        if (path.endsWith('/markdown')) return { markdown: '- e1' };
        if (path.includes('/docs?q=')) return { docs };
        return {};
      },
    },
    Date,
    Set,
    String,
    RegExp,
    Error,
    encodeURIComponent,
  };
  const output = await runInNewContext(
    `(async () => {\n${code}\n})`,
    context
  )();
  return { output, calls };
}

const event = (id: string, title: string) => ({
  externalEventId: id,
  title,
  description: '',
  startAtUtc: '2026-12-01T10:00:00Z',
  endAtUtc: '2026-12-01T11:00:00Z',
  status: 'confirmed',
});

test('queues an agent for each likely interview on the watched calendar', async t => {
  const { output, calls } = await run(
    [event('e1', 'Interview: Dana Cohen'), event('e2', 'Team standup')],
    [],
    'cloud',
    'pantheon'
  );
  t.deepEqual((output as any).queued, ['e1']);
  const job = calls.find(c => c.path.includes('/devices/cloud/jobs'))!;
  // A Claude Code job, which the cloud runner runs.
  t.is(job.body.model, 'claude-code');
  t.regex(job.body.instructions, /Dana Cohen/);
  t.regex(job.body.instructions, /CV/);
  t.regex(job.body.instructions, /LinkedIn/);
  const ledger = calls.find(
    c => c.path === '/api/notes/workspaces/ws1/docs' && c.method === 'POST'
  )!;
  t.regex(ledger.body.markdown, /- e1/);
});

test('an event already in the ledger is not queued twice', async t => {
  const { output, calls } = await run(
    [event('e1', 'Interview: Dana Cohen')],
    [{ docId: 'led', title: 'Interview events handed to the agent' }],
    'cloud',
    'pantheon'
  );
  t.deepEqual((output as any).queued, []);
  t.false(calls.some(c => c.path.includes('/devices/')));
});

test('by default it watches every calendar, renamed or not, on the cloud runner', async t => {
  const { output, calls } = await run([event('e1', 'Interview: Dana Cohen')]);
  // The second, "Personal" calendar's interview is watched too.
  t.deepEqual((output as any).queued, ['e1', 'x']);
  t.true(calls.some(c => c.path.includes('/devices/cloud/jobs')));
});

test('without an agent device it says what to set', async t => {
  await t.throwsAsync(run([], [], ''), { message: /AGENT_DEVICE/ });
});

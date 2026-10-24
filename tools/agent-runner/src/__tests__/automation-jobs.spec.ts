import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { type Job, NotesGraphApi } from '../api';
import { runClaimed, serve, type ServeOptions } from '../serve';
import { FakeNotesGraph, until } from './fake-notesgraph';

/** Automation jobs: code the runner runs itself, without a model. */

let ng: FakeNotesGraph;
beforeEach(async () => {
  ng = await new FakeNotesGraph().start();
});
afterEach(async () => {
  await ng.stop();
});

const noModel = (() => {
  throw new Error('an automation must not start a model');
}) as any;

const options = (over: Partial<ServeOptions> = {}): ServeOptions => ({
  api: new NotesGraphApi(ng.url, 'pat'),
  workspaces: ['ws-1'],
  deviceKey: 'cloud',
  runnerId: 'r1',
  settings: { workRoot: '/tmp/unused' } as any,
  query: noModel,
  tickMs: 5,
  pollMs: 10,
  ...over,
});

const automationJob = (code: string, over: Partial<Job> = {}): Job => ({
  id: 'auto-1',
  agentId: 'a1',
  agentName: 'Nightly',
  instructions: 'Run automation "Nightly"',
  context: '',
  model: null,
  status: 'running',
  title: 'Nightly',
  kind: 'automation',
  payload: {
    automationId: 'a1',
    runId: 'r1',
    versionId: 'v1',
    code,
    input: { n: 2 },
    timeoutSeconds: 5,
  },
  secrets: { TOKEN: 't' },
  ...over,
});

describe('automation jobs', () => {
  test('the code runs and its return value is the result', async () => {
    const end = await runClaimed(
      options(),
      'ws-1',
      automationJob(
        'console.log("doubling"); return { n: input.n * 2, t: secrets.TOKEN }'
      )
    );
    expect(end).toBe('done');
    const final = ng.reports.at(-1)!.fields;
    expect(final.status).toBe('done');
    expect(JSON.parse(final.result)).toEqual({ n: 4, t: 't' });
    expect(ng.log).toContain('doubling\n');
  });

  test('a failure is reported with its message and the log so far', async () => {
    const end = await runClaimed(
      options(),
      'ws-1',
      automationJob('console.log("step 1"); throw new Error("no luck")')
    );
    expect(end).toBe('error');
    const final = ng.reports.at(-1)!.fields;
    expect(final).toMatchObject({ status: 'error', error: 'no luck' });
    expect(ng.log).toContain('step 1\n');
  });

  test('a run past its time limit says it timed out', async () => {
    const job = automationJob('while (true) {}');
    job.payload!.timeoutSeconds = 1;
    expect(await runClaimed(options(), 'ws-1', job)).toBe('error');
    expect(ng.reports.at(-1)!.fields.error).toMatch(/^Timed out/);
  });

  test('a run stopped in the app is cancelled', async () => {
    ng.status = 'cancelled';
    const job = automationJob(
      'await new Promise(r => setTimeout(r, 10_000)); return 1'
    );
    expect(await runClaimed(options(), 'ws-1', job)).toBe('cancelled');
  });

  test('the runner asks for both kinds of job', async () => {
    ng.queue = [automationJob('return 1')];
    const stop = new AbortController();
    const served = serve(options({ signal: stop.signal }));
    await until(() => ng.reports.some(r => r.fields.status === 'done'));
    stop.abort();
    await served;
    expect(ng.claimKinds[0]).toEqual(['agent', 'automation']);
  });

  test('a token that may not run automations still gets agent jobs', async () => {
    ng.refuseAutomations = true;
    const lines: string[] = [];
    const stop = new AbortController();
    const served = serve(
      options({ signal: stop.signal, log: line => lines.push(line) })
    );
    await until(() => ng.claimKinds.length >= 3);
    stop.abort();
    await served;
    // One refused, then agent-only from then on.
    expect(ng.claimKinds[0]).toEqual(['agent', 'automation']);
    expect(ng.claimKinds.slice(1).every(k => k.join() === 'agent')).toBe(true);
    expect(lines.join('\n')).toMatch(/taking agent jobs only/);
  });

  test('with automations off, it asks for agent jobs only', async () => {
    const stop = new AbortController();
    const served = serve(options({ signal: stop.signal, automations: false }));
    await until(() => ng.claims >= 1);
    stop.abort();
    await served;
    expect(ng.claimKinds[0]).toEqual(['agent']);
  });
});

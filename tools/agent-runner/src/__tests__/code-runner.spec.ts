import { describe, expect, test } from 'vitest';

import {
  CodeCancelled,
  CodeFailed,
  CodeTimedOut,
  runCode,
} from '../code-runner';

/** An automation's code, run in a worker: output, logs, and how it can end. */

describe('runCode', () => {
  test('the return value is the output, as JSON', async () => {
    expect(
      await runCode({
        code: 'return { sum: input.a + input.b }',
        input: { a: 1, b: 2 },
      })
    ).toBe('{"sum":3}');
    expect(await runCode({ code: 'const x = 1;' })).toBeNull();
  });

  test('console lines reach the log as they are written', async () => {
    const lines: string[] = [];
    await runCode(
      { code: 'console.log("hi", { n: 1 }); console.error("bad")' },
      { say: line => lines.push(line) }
    );
    expect(lines).toEqual(['hi { n: 1 }', 'error: bad']);
  });

  test('the code reads the secrets it names, and nothing of the runner', async () => {
    expect(
      await runCode({
        code: 'return [secrets.API_KEY, typeof process, typeof require]',
        secrets: { API_KEY: 'k' },
      })
    ).toBe('["k","undefined","undefined"]');
  });

  test('a thrown error fails the run with its message', async () => {
    await expect(runCode({ code: 'throw new Error("nope")' })).rejects.toThrow(
      new CodeFailed('nope')
    );
  });

  test('code that never ends is stopped at its timeout', async () => {
    await expect(
      runCode({ code: 'while (true) {}', timeoutSeconds: 1 })
    ).rejects.toBeInstanceOf(CodeTimedOut);
  });

  test('a cancel stops it at once', async () => {
    const stop = new AbortController();
    const run = runCode(
      { code: 'while (true) {}', timeoutSeconds: 30 },
      { signal: stop.signal }
    );
    setTimeout(() => stop.abort(), 100);
    await expect(run).rejects.toBeInstanceOf(CodeCancelled);
  });

  test('awaiting works, timers included', async () => {
    expect(
      await runCode({
        code: 'await new Promise(r => setTimeout(r, 10)); return "late"',
      })
    ).toBe('"late"');
  });

  test('a value that is not JSON fails the run', async () => {
    await expect(
      runCode({ code: 'const a = {}; a.a = a; return a' })
    ).rejects.toThrow(/not JSON/);
  });
});

describe('notesgraph helper', () => {
  test('fetch sends the run token, JSON bodies, and parses replies', async () => {
    const { createServer } = await import('node:http');
    const seen: { url?: string; auth?: string; type?: string; body: string }[] =
      [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        seen.push({
          url: req.url,
          auth: req.headers.authorization,
          type: req.headers['content-type'],
          body,
        });
        if (req.url === '/api/fail') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'not yours' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, got: body }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      const output = await runCode({
        code: `
          const a = await notesgraph.fetch('/api/ping');
          const b = await notesgraph.fetch('/api/post', { method: 'POST', body: { x: 1 } });
          let failed = null;
          try { await notesgraph.fetch('/api/fail'); } catch (err) { failed = err.message + ' ' + err.status; }
          return { a, b, failed, ws: notesgraph.workspaceId, url: notesgraph.url };
        `,
        notesgraph: {
          url: `http://127.0.0.1:${port}/`,
          workspaceId: 'ws1',
          token: 'ut_run',
        },
      });
      expect(JSON.parse(output!)).toEqual({
        a: { ok: true, got: '' },
        b: { ok: true, got: '{"x":1}' },
        failed: 'GET /api/fail: 403 not yours 403',
        ws: 'ws1',
        url: `http://127.0.0.1:${port}/`,
      });
      expect(seen.map(s => [s.url, s.auth, s.type ?? null])).toEqual([
        ['/api/ping', 'Bearer ut_run', null],
        ['/api/post', 'Bearer ut_run', 'application/json'],
        ['/api/fail', 'Bearer ut_run', null],
      ]);
    } finally {
      server.close();
    }
  });

  /**
   * A fake automations API: "Double" doubles its input, "Broken" fails, and
   * each run is still running the first time it is read.
   */
  async function automationsServer() {
    const { createServer } = await import('node:http');
    const started: { id: string; body: any }[] = [];
    const reads = new Map<string, number>();
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', chunk => (raw += chunk));
      req.on('end', () => {
        const reply = (status: number, body: unknown) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        const base = '/api/workspaces/ws1/automations';
        const url = req.url ?? '';
        if (url === base) {
          reply(200, {
            automations: [
              { id: 'a-double', name: 'Double' },
              { id: 'a-broken', name: 'Broken' },
              { id: 'a-x1', name: 'Twin' },
              { id: 'a-x2', name: 'Twin' },
            ],
          });
          return;
        }
        const start = url.match(/\/automations\/([^/]+)\/run$/);
        if (start && req.method === 'POST') {
          const body = JSON.parse(raw);
          started.push({ id: start[1], body });
          reply(200, { run: { id: `run-${started.length}`, status: 'queued' } });
          return;
        }
        const read = url.match(/\/automations\/([^/]+)\/runs\/([^/]+)$/);
        if (read) {
          const [, id, runId] = read;
          const seen = (reads.get(runId) ?? 0) + 1;
          reads.set(runId, seen);
          const input = started[Number(runId.split('-')[1]) - 1]?.body.input;
          if (seen === 1) reply(200, { run: { id: runId, status: 'running' } });
          else if (id === 'a-broken') {
            reply(200, { run: { id: runId, status: 'failed', error: 'boom' } });
          } else {
            reply(200, {
              run: { id: runId, status: 'succeeded', output: input.n * 2 },
            });
          }
          return;
        }
        reply(404, { message: 'no route' });
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    return {
      started,
      close: () => server.close(),
      identity: {
        url: `http://127.0.0.1:${port}`,
        workspaceId: 'ws1',
        token: 'ut_run',
        automationId: 'a-caller',
        runId: 'r-caller',
      },
    };
  }

  test('automations.run calls another by name and returns its output', async () => {
    const fake = await automationsServer();
    try {
      const output = await runCode({
        code: `return await notesgraph.automations.run('Double', { n: 21 });`,
        notesgraph: fake.identity,
        timeoutSeconds: 20,
      });
      expect(JSON.parse(output!)).toBe(42);
      expect(fake.started).toEqual([
        {
          id: 'a-double',
          body: {
            input: { n: 21 },
            caller: { automationId: 'a-caller', runId: 'r-caller' },
          },
        },
      ]);
    } finally {
      fake.close();
    }
  });

  test('automations.start returns at once; wait gets the output later', async () => {
    const fake = await automationsServer();
    try {
      const output = await runCode({
        code: `
          const a = await notesgraph.automations.start('a-double', { n: 1 });
          const b = await notesgraph.automations.start('Double', { n: 2 });
          return { a, outputs: await Promise.all([a, b].map(notesgraph.automations.wait)) };
        `,
        notesgraph: fake.identity,
        timeoutSeconds: 20,
      });
      expect(JSON.parse(output!)).toEqual({
        a: { automationId: 'a-double', runId: 'run-1', status: 'queued' },
        outputs: [2, 4],
      });
    } finally {
      fake.close();
    }
  });

  test('a called run that fails, or an unclear name, throws', async () => {
    const fake = await automationsServer();
    try {
      const output = await runCode({
        code: `
          const why = async f => { try { await f(); } catch (err) { return err.message; } };
          return [
            await why(() => notesgraph.automations.run('Broken')),
            await why(() => notesgraph.automations.run('Twin')),
            await why(() => notesgraph.automations.run('Nobody')),
          ];
        `,
        notesgraph: fake.identity,
        timeoutSeconds: 20,
      });
      expect(JSON.parse(output!)).toEqual([
        'Called automation run run-1 failed: boom',
        '2 automations are named "Twin": call one by id',
        'No automation "Nobody" in this workspace',
      ]);
    } finally {
      fake.close();
    }
  });

  test('without an identity there is no notesgraph global', async () => {
    expect(await runCode({ code: 'return typeof notesgraph;' })).toBe(
      '"undefined"'
    );
  });
});

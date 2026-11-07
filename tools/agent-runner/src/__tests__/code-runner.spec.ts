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

  test('without an identity there is no notesgraph global', async () => {
    expect(await runCode({ code: 'return typeof notesgraph;' })).toBe(
      '"undefined"'
    );
  });
});

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

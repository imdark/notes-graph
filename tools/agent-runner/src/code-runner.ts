/**
 * Runs an automation's code: the body of an async function, given `input`
 * (what triggered it), `secrets` (the workspace secrets it names), `console`
 * and `fetch`. What it returns is the run's output.
 *
 * The code runs in a worker thread, inside a `vm` context. The worker is what
 * makes a run stoppable: a timeout or a cancel terminates it, however busy
 * the code is, and a crash or runaway memory takes down only the worker. The
 * `vm` context keeps the runner's own globals (process, require) out of the
 * code's scope. It is not a security boundary: code that sets out to can
 * reach the worker's realm, so only workspace admins may write automations,
 * and only devices that allow agent runs take them.
 */
import { Worker } from 'node:worker_threads';

export interface CodeJob {
  code: string;
  input?: unknown;
  secrets?: Record<string, string>;
  timeoutSeconds?: number;
}

export interface CodeRunOptions {
  /** Each console line as the code writes it. */
  say?: (line: string) => void;
  signal?: AbortSignal;
  /** Heap the worker may use, in MB. */
  memoryMb?: number;
}

export class CodeFailed extends Error {}
export class CodeTimedOut extends CodeFailed {}
export class CodeCancelled extends CodeFailed {}

const DEFAULT_TIMEOUT_SECONDS = 60;
const DEFAULT_MEMORY_MB = 256;
/** Most of one console line kept. */
const LINE_CHARS = 10_000;

/**
 * The worker, as source: an eval worker needs no file on disk, so it works
 * the same from the TypeScript sources and from a bundle.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const { inspect } = require('node:util');

const LINE_CHARS = ${LINE_CHARS};
const show = value =>
  typeof value === 'string' ? value : inspect(value, { depth: 4, breakLength: 120 });
const logAt = level => (...args) => {
  const line = args.map(show).join(' ').slice(0, LINE_CHARS);
  parentPort.postMessage({ type: 'log', line: level ? level + ': ' + line : line });
};

const context = vm.createContext({
  console: {
    log: logAt(''),
    info: logAt(''),
    debug: logAt(''),
    warn: logAt('warn'),
    error: logAt('error'),
  },
  input: workerData.input,
  secrets: Object.freeze({ ...workerData.secrets }),
  fetch,
  Headers,
  Request,
  Response,
  URL,
  URLSearchParams,
  AbortController,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  structuredClone,
  atob,
  btoa,
});

(async () => {
  try {
    const run = vm.runInContext(
      '(async () => {\\n' + workerData.code + '\\n})',
      context,
      { filename: 'automation.js', lineOffset: -1 }
    );
    const value = await run();
    let output;
    try {
      output = value === undefined ? null : JSON.stringify(value);
    } catch (err) {
      throw new Error('the return value is not JSON: ' + err.message);
    }
    parentPort.postMessage({ type: 'done', output: output ?? null });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    parentPort.postMessage({
      type: 'error',
      message,
      stack: err && err.stack ? String(err.stack) : '',
    });
  }
})();
`;

/**
 * Run the code to its end. Resolves with its return value as JSON (null for
 * none); rejects with CodeTimedOut, CodeCancelled or CodeFailed.
 */
export function runCode(job: CodeJob, opts: CodeRunOptions = {}) {
  const timeoutSeconds = job.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const memoryMb = opts.memoryMb ?? DEFAULT_MEMORY_MB;
  return new Promise<string | null>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new CodeCancelled('Cancelled'));
      return;
    }
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        code: job.code,
        input: job.input ?? null,
        secrets: job.secrets ?? {},
      },
      // No env: secrets come in as `secrets`, nothing else of the runner's.
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: memoryMb },
      stdout: true,
      stderr: true,
    });
    let settled = false;
    const finish = (end: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      // Already settled either way; a failed terminate leaves nothing to do.
      worker.terminate().catch(() => {});
      end();
    };
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new CodeTimedOut(`Timed out after ${timeoutSeconds}s`))
        ),
      timeoutSeconds * 1000
    );
    const onAbort = () => finish(() => reject(new CodeCancelled('Cancelled')));
    opts.signal?.addEventListener('abort', onAbort);

    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'log') opts.say?.(message.line);
      else if (message.type === 'done') finish(() => resolve(message.output));
      else if (message.type === 'error') {
        if (message.stack) opts.say?.(message.stack);
        finish(() => reject(new CodeFailed(message.message)));
      }
    });
    worker.on('error', err =>
      finish(() =>
        reject(
          new CodeFailed(
            /heap|memory/i.test(err.message)
              ? `Ran out of memory (${memoryMb} MB)`
              : err.message
          )
        )
      )
    );
    worker.on('exit', code =>
      finish(() =>
        reject(new CodeFailed(`The code's worker exited (code ${code})`))
      )
    );
  });
}

type WorkerMessage =
  | { type: 'log'; line: string }
  | { type: 'done'; output: string | null }
  | { type: 'error'; message: string; stack: string };

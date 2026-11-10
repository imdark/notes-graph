import type { RunOutcome } from './format';

export const RUN_TIMEOUT_MS = 10_000;

/**
 * Source of the worker that runs the code. The code becomes the body of an
 * async function, so `await` works at the top level and a `return` gives the
 * block a value (org's `:results value`). console output is captured as the
 * block's output.
 */
const WORKER_SOURCE = String.raw`
const show = v => {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return String(v);
  if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return String(v);
  try {
    const s = JSON.stringify(v, null, 2);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
};
self.onmessage = async e => {
  const logs = [];
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
    console[k] = (...args) => logs.push(args.map(show).join(' '));
  }
  try {
    const AsyncFunction = (async () => {}).constructor;
    const value = await new AsyncFunction(e.data)();
    self.postMessage({ ok: true, logs, value: value === undefined ? undefined : show(value) });
  } catch (err) {
    self.postMessage({ ok: false, logs, error: show(err) });
  }
};
`;

/**
 * Page loaded into the sandboxed iframe. It starts the worker, forwards the
 * code and posts the outcome back to the parent. `sandbox="allow-scripts"`
 * without `allow-same-origin` gives it an opaque origin, so the code cannot
 * read the app's storage or call its API with the user's session.
 */
const FRAME_SOURCE = `<!doctype html><script>
const workerSource = ${JSON.stringify(WORKER_SOURCE)};
window.addEventListener('message', e => {
  if (e.source !== parent) return;
  const { id, code } = e.data || {};
  const done = outcome => parent.postMessage({ id, outcome }, '*');
  let worker;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
  } catch (err) {
    done({ ok: false, logs: [], error: 'Could not start a worker: ' + err });
    return;
  }
  worker.onmessage = m => { done(m.data); worker.terminate(); };
  worker.onerror = ev => { ev.preventDefault(); done({ ok: false, logs: [], error: ev.message || 'Worker error' }); worker.terminate(); };
  worker.postMessage(code);
});
parent.postMessage({ ready: true }, '*');
</script>`;

let nextRunId = 0;

/**
 * Run JavaScript away from the app: a worker inside a sandboxed iframe.
 * Removing the iframe on timeout tears the worker down with it, so an
 * endless loop cannot hang the editor.
 */
export function runJavaScript(
  code: string,
  timeoutMs = RUN_TIMEOUT_MS
): Promise<RunOutcome> {
  const id = ++nextRunId;
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.display = 'none';
  frame.srcdoc = FRAME_SOURCE;

  return new Promise<RunOutcome>(resolve => {
    const finish = (outcome: RunOutcome) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      resolve(outcome);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return;
      const data = e.data as
        | { ready?: boolean; id?: number; outcome?: RunOutcome }
        | undefined;
      if (data?.ready) {
        frame.contentWindow?.postMessage({ id, code }, '*');
      } else if (data?.id === id && data.outcome) {
        finish(data.outcome);
      }
    };
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          logs: [],
          error: `Stopped after ${timeoutMs / 1000}s without finishing.`,
        }),
      timeoutMs
    );
    window.addEventListener('message', onMessage);
    document.body.append(frame);
  });
}

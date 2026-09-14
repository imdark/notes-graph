import { useCallback, useState, useSyncExternalStore } from 'react';

/**
 * Lightweight, always-on error inventory. Captures uncaught errors, unhandled
 * promise rejections and `console.error` calls into an in-memory ring, and
 * surfaces a red semi-transparent button (only while errors exist) to review,
 * copy, or submit them. Meant for field debugging on mobile/webview builds
 * where native devtools aren't handy.
 *
 * Submit target: the link-card sidecar's `/clip/log` sink (reachable from the
 * device); inventory server-side with `docker logs notesgraph_linkcard`.
 */

const SUBMIT_URL = 'https://app.notesgraph.com/clip/log';
const MAX_ERRORS = 100;

export interface CapturedError {
  id: string;
  time: string;
  source: 'window.onerror' | 'unhandledrejection' | 'console.error';
  message: string;
  stack?: string;
}

const errors: CapturedError[] = [];
// `view` is an immutable copy handed to React. useSyncExternalStore compares
// snapshots by reference, so we must swap in a NEW array on every change (and
// keep it stable between changes) — returning the mutated `errors` array would
// never trigger a re-render.
let view: CapturedError[] = [];
const listeners = new Set<() => void>();
let seq = 0;
let installed = false;

function snapshot() {
  return view;
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit() {
  view = errors.slice();
  for (const l of listeners) l();
}

function fmtArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function record(
  source: CapturedError['source'],
  message: string,
  stack?: string
) {
  // Re-render with a fresh array reference so useSyncExternalStore recomputes.
  errors.unshift({
    id: `e${seq++}`,
    time: new Date().toISOString(),
    source,
    message: message.slice(0, 4000),
    stack: stack?.slice(0, 8000),
  });
  if (errors.length > MAX_ERRORS) errors.length = MAX_ERRORS;
  emit();
}

/** Install the global hooks once (idempotent across remounts / HMR). */
function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', event => {
    const err = event.error as Error | undefined;
    record(
      'window.onerror',
      err?.message ?? event.message ?? 'Unknown error',
      err?.stack
    );
  });

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason as { message?: string; stack?: string } | string;
    record(
      'unhandledrejection',
      typeof reason === 'string'
        ? reason
        : (reason?.message ?? fmtArg(reason)),
      typeof reason === 'object' ? reason?.stack : undefined
    );
  });

  // Wrap console.error so logged (but not thrown) errors are inventoried too.
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const first = args.find(a => a instanceof Error) as Error | undefined;
      record(
        'console.error',
        args.map(fmtArg).join(' '),
        first?.stack
      );
    } catch {
      // never let capture break logging
    }
    original(...args);
  };
}

const btnBase: React.CSSProperties = {
  position: 'fixed',
  right: 'max(12px, env(safe-area-inset-right))',
  bottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 72px)',
  // below eruda (~9999999): when the on-screen debug console is open it must
  // win — this button previously floated above it and swallowed taps on the
  // console's own controls
  zIndex: 9999990,
  border: 'none',
  borderRadius: 999,
  padding: '10px 14px',
  font: '600 13px/1 ui-monospace, monospace',
  color: '#fff',
  background: 'rgba(220, 38, 38, 0.72)',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
  cursor: 'pointer',
};

export const ErrorReporter = () => {
  install();
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string>('');

  const copy = useCallback(async () => {
    const text = list
      .map(e => `[${e.time}] (${e.source}) ${e.message}\n${e.stack ?? ''}`)
      .join('\n\n----\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied to clipboard');
    } catch {
      setStatus('Copy failed — select text manually');
    }
  }, [list]);

  const submit = useCallback(async () => {
    setStatus('Submitting…');
    try {
      const res = await fetch(SUBMIT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ts: Date.now(),
          ua: navigator.userAgent,
          url: location.href,
          errors: list,
        }),
      });
      setStatus(res.ok ? 'Submitted ✓' : `Submit failed (HTTP ${res.status})`);
    } catch (err) {
      setStatus(`Submit failed: ${(err as Error)?.message ?? 'network error'}`);
    }
  }, [list]);

  const clear = useCallback(() => {
    errors.length = 0;
    emit();
    setStatus('');
    setOpen(false);
  }, []);

  if (list.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        style={btnBase}
        onClick={() => setOpen(true)}
        aria-label={`${list.length} error${list.length > 1 ? 's' : ''} captured`}
      >
        ⚠ {list.length} error{list.length > 1 ? 's' : ''}
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        // below eruda so the on-screen debug console stays interactive
        zIndex: 9999991,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={() => setOpen(false)}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          marginTop: 'auto',
          maxHeight: '80vh',
          background: '#141414',
          color: '#eee',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid #2a2a2a',
          }}
        >
          <strong style={{ color: '#f87171' }}>
            {list.length} error{list.length > 1 ? 's' : ''}
          </strong>
          <span style={{ flex: 1, fontSize: 12, color: '#9ca3af' }}>
            {status}
          </span>
          <button type="button" style={pill} onClick={copy}>
            Copy
          </button>
          <button type="button" style={pill} onClick={submit}>
            Submit
          </button>
          <button type="button" style={pill} onClick={clear}>
            Clear
          </button>
          <button type="button" style={pill} onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
        <div style={{ overflow: 'auto', padding: '8px 16px 16px' }}>
          {list.map(e => (
            <div
              key={e.id}
              style={{
                padding: '8px 0',
                borderBottom: '1px solid #232323',
                font: '12px/1.4 ui-monospace, monospace',
              }}
            >
              <div style={{ color: '#9ca3af' }}>
                {e.time} · {e.source}
              </div>
              <div style={{ color: '#fca5a5', whiteSpace: 'pre-wrap' }}>
                {e.message}
              </div>
              {e.stack ? (
                <pre
                  style={{
                    margin: '4px 0 0',
                    color: '#9ca3af',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {e.stack}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const pill: React.CSSProperties = {
  border: '1px solid #3a3a3a',
  background: '#1f1f1f',
  color: '#eee',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  cursor: 'pointer',
};

import { Button } from '@notesgraph/component';
import {
  TERMINAL_HARNESSES,
  type TerminalConnection,
  TerminalService,
  type TerminalSessionInfo,
} from '@notesgraph/core/modules/agents';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import {
  type ClipboardEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { keyToInput } from '../../modules/agents/services/terminal-screen';
import * as styles from './styles.css';

const harnessName = (id: string) =>
  TERMINAL_HARNESSES.find(h => h.id === id)?.name ?? id;

const sessionLabel = (s: TerminalSessionInfo) =>
  `${harnessName(s.harness)} · ${s.deviceKey}${s.status === 'exited' ? ' (ended)' : ''}`;

/** The screen of one session; keys typed while it is focused go to it. */
const TerminalScreenView = ({
  connection,
}: {
  connection: TerminalConnection;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  useLiveData(connection.tick$);
  const session = useLiveData(connection.session$);

  // Tell the harness how many characters fit.
  useEffect(() => {
    const el = ref.current;
    const probe = measure.current;
    if (!el || !probe) return;
    const fit = () => {
      const box = probe.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const cols = Math.floor((el.clientWidth - 20) / (box.width / 10));
      const rows = Math.floor((el.clientHeight - 20) / box.height);
      if (cols > 10 && rows > 3) connection.resize(cols, rows);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [connection]);

  // Follow the output unless the reader scrolled up.
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const onKeyDown = (e: KeyboardEvent) => {
    const selected = window.getSelection()?.toString();
    if (e.ctrlKey && e.key === 'c' && selected) return;
    const data = keyToInput(e.nativeEvent);
    if (data === null || session.status === 'exited') return;
    e.preventDefault();
    connection.send(data);
  };
  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    if (!text || session.status === 'exited') return;
    e.preventDefault();
    // Bracketed paste keeps a pasted newline from submitting early.
    connection.send(`\x1b[200~${text}\x1b[201~`);
  };

  const rows = connection.screen.spans();
  return (
    <>
      <div
        ref={ref}
        className={styles.screen}
        tabIndex={0}
        role="textbox"
        aria-label={`Terminal: ${sessionLabel(session)}`}
        aria-multiline="true"
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onScroll={e => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        data-testid="remote-terminal-screen"
      >
        <span ref={measure} className={styles.measure} aria-hidden>
          MMMMMMMMMM
        </span>
        {session.status === 'starting' ? (
          <span className={styles.note}>
            Waiting for {session.deviceKey} to start{' '}
            {harnessName(session.harness)}…
          </span>
        ) : null}
        {rows.map((spans, y) => (
          <div key={y}>
            {spans.map((span, i) => (
              <span
                key={i}
                style={{
                  color: span.inverse ? span.bg : span.fg,
                  background: span.inverse ? (span.fg ?? '#d6dbe3') : span.bg,
                  fontWeight: span.bold ? 700 : undefined,
                  opacity: span.dim ? 0.65 : undefined,
                  fontStyle: span.italic ? 'italic' : undefined,
                  textDecoration: span.underline ? 'underline' : undefined,
                }}
              >
                {span.text}
              </span>
            ))}
            {spans.length === 0 ? ' ' : null}
          </div>
        ))}
      </div>
      {BUILD_CONFIG.isMobileEdition ? (
        <TouchInput
          disabled={session.status === 'exited'}
          send={data => connection.send(data)}
        />
      ) : null}
    </>
  );
};

/** Keys a phone keyboard doesn't have, sent as the terminal sees them. */
const TOUCH_KEYS: { label: string; data: string }[] = [
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: '⇧Tab', data: '\x1b[Z' },
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: '←', data: '\x1b[D' },
  { label: '→', data: '\x1b[C' },
  { label: '⌫', data: '\x7f' },
  { label: '⏎', data: '\r' },
  { label: 'Ctrl-C', data: '\x03' },
];

// The harness reads a burst of text and a return together as a paste, so
// the return goes on its own a moment later and submits.
const SUBMIT_DELAY_MS = 120;

/**
 * Typing on a phone: a phone keyboard sends no usable key events to the
 * screen, so text is written here (autocorrect and voice typing work) and
 * goes to the harness on Send, with the keys it lacks in a row above.
 */
const TouchInput = ({
  disabled,
  send,
}: {
  disabled: boolean;
  send: (data: string) => void;
}) => {
  const [text, setText] = useState('');
  const submit = () => {
    if (disabled) return;
    if (text) {
      send(text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text);
      setTimeout(() => send('\r'), SUBMIT_DELAY_MS);
    } else {
      send('\r');
    }
    setText('');
  };
  return (
    <div className={styles.touch}>
      <div className={styles.keys}>
        {TOUCH_KEYS.map(key => (
          <button
            key={key.label}
            type="button"
            className={styles.key}
            disabled={disabled}
            // Keep the text field focused, so the keyboard stays up.
            onPointerDown={e => e.preventDefault()}
            onClick={() => send(key.data)}
          >
            {key.label}
          </button>
        ))}
      </div>
      <div className={styles.compose}>
        <textarea
          className={styles.input}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder="Message the harness"
          aria-label="Terminal input"
          enterKeyHint="send"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          data-testid="remote-terminal-input"
        />
        <Button
          variant="primary"
          disabled={disabled}
          onPointerDown={e => e.preventDefault()}
          onClick={submit}
        >
          Send
        </Button>
      </div>
    </div>
  );
};

/**
 * Open a harness (Claude Code, Codex, ...) on a connected device and use it
 * from here. The harness runs under `wf` on the device, so it has the
 * workspace's MCP tools; this shows its screen live and sends keys back.
 * Closing the page does not end it: pick it from the list to carry on.
 */
export const RemoteTerminal = ({
  deviceKey: fixedDevice,
}: {
  /** Start sessions on this device only (the agent view knows its device). */
  deviceKey?: string;
}) => {
  const terminals = useService(TerminalService);
  const [devices, setDevices] = useState<string[]>([]);
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [device, setDevice] = useState(fixedDevice ?? '');
  const [harness, setHarness] = useState<string>('claude');
  const [connection, setConnection] = useState<TerminalConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await terminals.list(fixedDevice);
      setDevices(res.devices);
      setSessions(res.sessions);
      setDevice(current => current || res.devices[0] || '');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [terminals, fixedDevice]);

  useEffect(() => {
    refresh().catch(() => {});
    const timer = setInterval(() => refresh().catch(() => {}), 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Leaving the view detaches; the session stays on the device.
  useEffect(() => () => connection?.detach(), [connection]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      setConnection(
        await terminals.open({
          deviceKey: device,
          harness: harness as never,
        })
      );
      await refresh();
    });

  const resume = (session: TerminalSessionInfo) =>
    run(async () => setConnection(await terminals.attach(session)));

  const session = useLiveData(connection?.session$ ?? EMPTY_SESSION$);
  const connected = useLiveData(connection?.connected$ ?? NOT_CONNECTED$);

  if (!terminals.hasServer) {
    return (
      <div className={styles.note}>
        Remote terminals need a cloud or self-hosted workspace.
      </div>
    );
  }

  return (
    <div className={styles.root} data-testid="remote-terminal">
      <div className={styles.bar}>
        {fixedDevice ? (
          <span>{fixedDevice}</span>
        ) : (
          <select
            className={styles.select}
            value={device}
            onChange={e => setDevice(e.target.value)}
            aria-label="Device"
          >
            {devices.length === 0 ? (
              <option value="">No device online</option>
            ) : null}
            {devices.map(key => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        )}
        <select
          className={styles.select}
          value={harness}
          onChange={e => setHarness(e.target.value)}
          aria-label="Harness"
        >
          {TERMINAL_HARNESSES.map(h => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <Button
          variant="primary"
          disabled={busy || !device || !devices.includes(device)}
          onClick={start}
        >
          Open
        </Button>
        <span className={styles.spacer} />
        {connection ? (
          <>
            <span>
              {session.status === 'exited'
                ? `Ended${session.exitCode !== null ? ` (${session.exitCode})` : ''}`
                : connected
                  ? 'Live'
                  : 'Reconnecting…'}
            </span>
            <Button onClick={() => setConnection(null)}>Detach</Button>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await connection.close();
                  if (session.status === 'exited') setConnection(null);
                  await refresh();
                })
              }
            >
              {session.status === 'exited' ? 'Remove' : 'End'}
            </Button>
          </>
        ) : null}
      </div>
      {sessions.length > 0 ? (
        <div className={styles.sessions}>
          {sessions.map(s => (
            <button
              key={s.id}
              className={styles.chip}
              data-active={connection && session.id === s.id ? '' : undefined}
              data-exited={s.status === 'exited' ? '' : undefined}
              onClick={() => resume(s)}
            >
              {sessionLabel(s)}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      {connection ? (
        <TerminalScreenView connection={connection} />
      ) : (
        <div className={styles.note}>
          {devices.length === 0
            ? 'No device is connected for terminals. On the machine, run `wf terminal install` (or `wf terminal serve` to try it once).'
            : 'Open a harness on a device, or pick a session above to carry on where you left off.'}
        </div>
      )}
    </div>
  );
};

const NO_SESSION = {
  id: '',
  deviceKey: '',
  harness: 'claude',
  resume: null,
  status: 'starting',
  exitCode: null,
  createdAt: 0,
  updatedAt: 0,
  length: 0,
} satisfies TerminalSessionInfo as TerminalSessionInfo;
const EMPTY_SESSION$ = new LiveData<TerminalSessionInfo>(NO_SESSION);
const NOT_CONNECTED$ = new LiveData(false);

export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  message: string;
}

const MAX_ENTRIES = 500;
const LEVELS: LogLevel[] = ['log', 'info', 'warn', 'error'];

let entries: LogEntry[] = [];
let nextId = 1;
let installed = false;
const listeners = new Set<() => void>();

function format(arg: unknown): string {
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

function push(level: LogLevel, args: unknown[]) {
  entries = [
    ...entries.slice(-(MAX_ENTRIES - 1)),
    {
      id: nextId++,
      time: Date.now(),
      level,
      message: args.map(format).join(' '),
    },
  ];
  listeners.forEach(l => l());
}

/** Mirror console output and uncaught errors into an in-memory ring buffer. */
export function installLogBuffer() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      push(level, args);
    };
  }
  window.addEventListener('error', e => push('error', [e.error ?? e.message]));
  window.addEventListener('unhandledrejection', e =>
    push('error', ['Unhandled rejection:', e.reason])
  );
}

export const logBuffer = {
  getSnapshot: () => entries,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  clear() {
    entries = [];
    listeners.forEach(l => l());
  },
};

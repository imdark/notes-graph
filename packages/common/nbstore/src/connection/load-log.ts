/**
 * A short record of what was slow while the app loaded: a storage connection
 * that stalled, timed out or failed, and a note that took long to show.
 *
 * A stalled load leaves nothing behind once the page is reloaded, and by then
 * it has usually stopped happening. So each event is kept three ways:
 * - a console warning, prefixed `[load-log]`;
 * - `globalThis.__ngLoadLog`, for this page or worker while it lives;
 * - localStorage `notesgraph:load-log`, the newest 200, which survives
 *   reloads and is shared by every tab. A worker has no localStorage, so it
 *   broadcasts its events and an open page saves them.
 *
 * Read it in the console with
 * `JSON.parse(localStorage['notesgraph:load-log'])`.
 */
export interface LoadLogEntry {
  /** ISO time the event was recorded. */
  at: string;
  /** What happened, e.g. `connection-timeout`, `slow-note-load`. */
  event: string;
  /** Where it ran: `page`, or the worker's kind. */
  where: string;
  /** Milliseconds since this page or worker started. */
  sinceStartMs: number;
  [detail: string]: unknown;
}

export const LOAD_LOG_KEY = 'notesgraph:load-log';
const MAX_ENTRIES = 200;

const where = (): string => {
  if (typeof document !== 'undefined') return 'page';
  const name = (globalThis as { constructor?: { name?: string } }).constructor
    ?.name;
  return name ? name.replace(/GlobalScope$/, '') : 'worker';
};

export function recordLoadEvent(
  event: string,
  detail: Record<string, unknown> = {}
): LoadLogEntry {
  const entry: LoadLogEntry = {
    at: new Date().toISOString(),
    event,
    where: where(),
    sinceStartMs: Math.round(globalThis.performance?.now?.() ?? 0),
    ...detail,
  };
  try {
    console.warn('[load-log]', event, JSON.stringify(entry));
    const scope = globalThis as { __ngLoadLog?: LoadLogEntry[] };
    const kept = (scope.__ngLoadLog ??= []);
    kept.push(entry);
    if (kept.length > MAX_ENTRIES) kept.splice(0, kept.length - MAX_ENTRIES);
    if (typeof localStorage !== 'undefined') {
      persist(entry);
    } else {
      // A worker has no localStorage: an open page keeps it instead.
      relay()?.postMessage(entry);
    }
  } catch {
    // The log must never break what it watches.
  }
  return entry;
}

function persist(entry: LoadLogEntry) {
  const saved = JSON.parse(localStorage.getItem(LOAD_LOG_KEY) ?? '[]');
  const next = [...(Array.isArray(saved) ? saved : []), entry];
  localStorage.setItem(LOAD_LOG_KEY, JSON.stringify(next.slice(-MAX_ENTRIES)));
}

let channel: BroadcastChannel | null | undefined;
function relay(): BroadcastChannel | null {
  if (channel === undefined) {
    channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(LOAD_LOG_KEY);
  }
  return channel;
}

// Pages keep what workers record. Web Locks pick one page per entry, so
// several open tabs don't each save a copy.
if (typeof document !== 'undefined' && typeof localStorage !== 'undefined') {
  try {
    relay()?.addEventListener('message', event => {
      const entry = event.data as LoadLogEntry;
      if (!entry || typeof entry.event !== 'string') return;
      const save = () => {
        try {
          persist(entry);
        } catch {
          // full or blocked storage: the console line is still there
        }
      };
      const locks = globalThis.navigator?.locks;
      if (!locks) return save();
      locks
        .request(
          `${LOAD_LOG_KEY}:${entry.at}:${entry.event}:${entry.sinceStartMs}`,
          { ifAvailable: true },
          async lock => {
            if (!lock) return;
            save();
            // Held briefly, so the other tabs' requests find it taken.
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        )
        .catch(() => {});
    });
  } catch {
    // no relay: worker events stay in the worker's console
  }
}

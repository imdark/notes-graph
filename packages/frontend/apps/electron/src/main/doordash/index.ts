import { BrowserWindow } from 'electron';

import { logger } from '../logger';
import type { NamespaceHandlers } from '../type';

/** A normalized DoorDash order, extracted from DoorDash's own API responses. */
export interface DoorDashOrder {
  id?: string | number;
  store?: string;
  date?: string | number;
  total?: string | number;
  itemCount?: string | number;
}

// The user clicks an injected overlay button when they've loaded their history;
// the click sets this sentinel title, which the main process listens for.
const DONE_SIGNAL = '__NG_DOORDASH_IMPORT__';

// Injected into the DoorDash page (privileged, bypasses CSP) so the user has a
// clear, in-window way to say "these are my orders, import them".
const OVERLAY_JS = `(() => {
  if (document.getElementById('ng-dd-import-btn')) return;
  const b = document.createElement('button');
  b.id = 'ng-dd-import-btn';
  b.textContent = 'Import these orders into NotesGraph';
  Object.assign(b.style, {
    position: 'fixed', zIndex: '2147483647', right: '20px', bottom: '20px',
    padding: '12px 18px', background: '#EB1700', color: '#fff', border: 'none',
    borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
    boxShadow: '0 6px 20px rgba(0,0,0,.35)', fontFamily: 'system-ui, sans-serif',
  });
  b.addEventListener('click', () => {
    b.textContent = 'Importing…';
    b.disabled = true;
    document.title = '${DONE_SIGNAL}';
  });
  document.body.appendChild(b);
})();`;

/** Deep-walk a JSON value, scoring arrays by how "order-like" their items are. */
function findOrderArrays(root: unknown): { score: number; items: any[] }[] {
  const results: { score: number; items: any[] }[] = [];
  const orderKey = /store|merchant|restaurant/i;
  const totalKey = /total|grandTotal|amount|subtotal/i;
  const dateKey = /created|submitted|delivered|timestamp|date/i;
  const seen = new Set<unknown>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      const sample = value.find(v => v && typeof v === 'object');
      if (sample) {
        const keys = JSON.stringify(Object.keys(sample));
        const score =
          (orderKey.test(keys) ? 1 : 0) +
          (totalKey.test(keys) ? 1 : 0) +
          (dateKey.test(keys) ? 1 : 0);
        if (score >= 2 && value.length) results.push({ score, items: value });
      }
      value.forEach(walk);
      return;
    }
    Object.values(value as Record<string, unknown>).forEach(walk);
  };
  walk(root);
  return results.sort(
    (a, b) => b.score - a.score || b.items.length - a.items.length
  );
}

/** Best-effort normalization of a raw order object into a flat record. */
function normalizeOrder(o: any): DoorDashOrder {
  const pick = (obj: any, re: RegExp) => {
    for (const [k, v] of Object.entries(obj)) {
      if (re.test(k) && (typeof v === 'string' || typeof v === 'number')) {
        return v as string | number;
      }
    }
    return undefined;
  };
  const store = o.store || o.merchant || o.restaurant || {};
  return {
    id: o.id ?? o.orderUuid ?? o.uuid ?? pick(o, /^id$|uuid/i),
    store:
      (typeof store === 'object'
        ? store.name || store.businessName
        : store) ?? pick(o, /store|merchant|restaurant/i),
    date: pick(o, /created|submitted|delivered|date/i),
    total: pick(o, /grandTotal|orderTotal|^total$|amount/i),
    itemCount: Array.isArray(o.items) ? o.items.length : pick(o, /itemCount|quantity/i),
  };
}

function extractOrders(captures: unknown[]): DoorDashOrder[] {
  const candidates = captures.flatMap(findOrderArrays);
  candidates.sort((a, b) => b.score - a.score || b.items.length - a.items.length);
  return (candidates[0]?.items ?? []).map(normalizeOrder);
}

/**
 * Open a real browser window for the user to log into DoorDash, capture the
 * order-history JSON DoorDash's own web app fetches (via CDP — the only way to
 * read response bodies), and return the extracted orders. Runs on an isolated
 * session partition so DoorDash cookies never mix with NotesGraph auth.
 */
async function captureOrders(): Promise<DoorDashOrder[]> {
  const win = new BrowserWindow({
    width: 1200,
    height: 860,
    show: true,
    title: 'Log in to DoorDash, then click “Import these orders”',
    webPreferences: {
      partition: 'persist:notesgraph-doordash',
      sandbox: true,
    },
  });

  const captures: unknown[] = [];
  const pending = new Map<string, string>(); // requestId -> url

  const dbg = win.webContents.debugger;
  try {
    dbg.attach('1.3');
    await dbg.sendCommand('Network.enable');
  } catch (err) {
    logger.warn('[doordash] failed to attach debugger', err);
  }

  dbg.on('message', (_event, method, params: any) => {
    try {
      if (method === 'Network.responseReceived') {
        const url: string = params?.response?.url ?? '';
        const mime: string = params?.response?.mimeType ?? '';
        if (
          /doordash\.com/.test(url) &&
          (mime.includes('json') || /graphql|order/i.test(url))
        ) {
          pending.set(params.requestId, url);
        }
      } else if (method === 'Network.loadingFinished') {
        if (!pending.has(params.requestId)) return;
        pending.delete(params.requestId);
        dbg
          .sendCommand('Network.getResponseBody', { requestId: params.requestId })
          .then((res: any) => {
            const text = res.base64Encoded
              ? Buffer.from(res.body, 'base64').toString('utf8')
              : res.body;
            try {
              captures.push(JSON.parse(text));
            } catch {
              /* not JSON — ignore */
            }
          })
          .catch(() => {});
      }
    } catch {
      /* defensive: never let a CDP message crash the handler */
    }
  });

  const inject = () => {
    win.webContents.executeJavaScript(OVERLAY_JS).catch(() => {});
  };
  win.webContents.on('did-finish-load', inject);
  win.webContents.on('did-navigate-in-page', inject);

  await win.loadURL('https://www.doordash.com/orders').catch(() => {});

  return new Promise<DoorDashOrder[]>(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      // Brief settle so any in-flight response bodies are captured first.
      setTimeout(() => {
        const orders = extractOrders(captures);
        logger.info(`[doordash] extracted ${orders.length} orders`);
        try {
          dbg.detach();
        } catch {
          /* already detached */
        }
        if (!win.isDestroyed()) win.destroy();
        resolve(orders);
      }, 600);
    };
    win.webContents.on('page-title-updated', (_e, title) => {
      if (title === DONE_SIGNAL) finish();
    });
    // If the user just closes the window, import whatever was captured.
    win.on('closed', () => {
      if (done) return;
      done = true;
      resolve(extractOrders(captures));
    });
  });
}

export const doordashHandlers = {
  importOrders: async () => {
    return captureOrders();
  },
} satisfies NamespaceHandlers;

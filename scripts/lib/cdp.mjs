// Minimal, dependency-free Chrome DevTools Protocol client.
//
// Discovery does NOT use the /json HTTP endpoints (deprecated / removed in
// current Chrome). Instead it reads the browser-level WebSocket URL from the
// `DevToolsActivePort` file Chrome writes into its --user-data-dir, then
// enumerates page targets over CDP via `Target.getTargets`. Node 21+ ships a
// global WebSocket, so there are no npm dependencies.
//
// Override discovery with CDP_WS=ws://... ; pick a page with CDP_MATCH=<url
// substring> ; the profile dir defaults to CHROME_PROFILE.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function browserWsUrl() {
  if (process.env.CDP_WS) return process.env.CDP_WS;
  const profile = process.env.CHROME_PROFILE || '/tmp/notesgraph-chrome-debug';
  const file = join(profile, 'DevToolsActivePort');
  let txt;
  try {
    txt = await readFile(file, 'utf8');
  } catch {
    throw new Error(
      `no DevToolsActivePort in ${profile}; start Chrome first: debug-local-web-dev.sh inspect`
    );
  }
  const [port, path] = txt.trim().split('\n');
  if (!port || !path) throw new Error(`malformed DevToolsActivePort: ${JSON.stringify(txt)}`);
  return `ws://127.0.0.1:${port}${path}`;
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

// Connect to the browser endpoint and return an open CDP client.
export async function connect() {
  const url = await browserWsUrl();
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`cannot open CDP ws ${url}`)), { once: true });
  });
  return new CDP(ws);
}

// Attach to a page target (CDP_MATCH url-substring wins, else the first page)
// with a flattened session, and return its sessionId.
export async function attachPage(cdp, match = process.env.CDP_MATCH || '') {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const pages = targetInfos.filter(t => t.type === 'page');
  const target = (match && pages.find(t => (t.url || '').includes(match))) || pages[0];
  if (!target) throw new Error('no CDP page target found');
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  return { sessionId, target };
}

export function die(msg) {
  console.error(msg);
  process.exit(1);
}

import {
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { safeParseManifest } from '@notesgraph/plugin-sdk';
import type { PluginRequest } from '@notesgraph/plugin-sdk/server';

import { createFaas } from './faas';

const PORT = Number(process.env.PORT ?? 8099);
const DATA_DIR = process.env.PLUGIN_DATA_DIR ?? join(process.cwd(), 'data');
const PLUGINS_DIR = join(DATA_DIR, 'plugins');
const REGISTRY_FILE = join(DATA_DIR, 'registry.json');
const KEY_FILE = join(DATA_DIR, 'signing-key.json');
// Auto-approve every submission for now; set AUTO_APPROVE=false to require
// review via the /admin curation endpoints before a plugin is listed.
const AUTO_APPROVE = process.env.AUTO_APPROVE !== 'false';
// Folder of bundled plugins seeded into the registry on startup so first-party
// plugins (e.g. "Notes Graph Import") are always listed without a manual publish.
const BUNDLED_PLUGINS_DIR =
  process.env.PLUGIN_SEED_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugin-template');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

type Status = 'pending' | 'approved' | 'rejected';

interface RegistryEntry {
  id: string;
  version: string;
  name: string;
  description?: string;
  author?: string;
  platforms: string[];
  permissions: string[];
  clientEntry: string;
  serverEntry?: string;
  hasServer: boolean;
  files: string[];
  status: Status;
  signature: string;
  publishedAt: number;
}

function ensureDirs() {
  for (const dir of [DATA_DIR, PLUGINS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
ensureDirs();

// ---- signing key (ed25519); clients verify bundle integrity/origin ----
function loadKeys(): { publicKey: string; privateKey: string } {
  if (existsSync(KEY_FILE)) {
    return JSON.parse(readFileSync(KEY_FILE, 'utf8')) as {
      publicKey: string;
      privateKey: string;
    };
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const keys = { publicKey, privateKey };
  writeFileSync(KEY_FILE, JSON.stringify(keys));
  return keys;
}
const keys = loadKeys();

function signBundle(manifest: unknown, files: Record<string, string>): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(manifest));
  for (const name of Object.keys(files).sort()) {
    hash.update(name);
    hash.update(files[name]);
  }
  return cryptoSign(null, hash.digest(), keys.privateKey).toString('base64');
}

// ---- registry persistence ----
function loadRegistry(): RegistryEntry[] {
  if (!existsSync(REGISTRY_FILE)) return [];
  try {
    return JSON.parse(readFileSync(REGISTRY_FILE, 'utf8')) as RegistryEntry[];
  } catch {
    return [];
  }
}
let registry = loadRegistry();
function saveRegistry() {
  writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

const faas = createFaas(PLUGINS_DIR);

/** Latest approved version of a plugin that ships a server bundle. */
function latestServerEntry(id: string): RegistryEntry | undefined {
  return registry
    .filter(e => e.id === id && e.status === 'approved' && e.serverEntry)
    .sort((a, b) => b.publishedAt - a.publishedAt)[0];
}

function latestApprovedById(): RegistryEntry[] {
  const byId = new Map<string, RegistryEntry>();
  for (const entry of registry) {
    if (entry.status !== 'approved') continue;
    const existing = byId.get(entry.id);
    if (!existing || entry.publishedAt > existing.publishedAt) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()];
}

function publicView(entry: RegistryEntry) {
  return {
    id: entry.id,
    version: entry.version,
    name: entry.name,
    description: entry.description,
    author: entry.author,
    platforms: entry.platforms,
    permissions: entry.permissions,
    hasServer: entry.hasServer,
    status: entry.status,
    signature: entry.signature,
    downloadUrl: `/download/${entry.id}/${entry.version}`,
  };
}

// ---- http helpers ----
function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
}
async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
function contentType(file: string): string {
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.js') || file.endsWith('.mjs')) return 'text/javascript';
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

// ---- publish ----
interface PublishBody {
  manifest?: unknown;
  files?: Record<string, string>;
}
function publish(body: PublishBody): { status: number; body: unknown } {
  const parsed = safeParseManifest(body.manifest);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: 'invalid manifest', issues: parsed.error.issues },
    };
  }
  const manifest = parsed.data;
  const files = body.files ?? {};
  const clientEntry = manifest.entry.client ?? 'index.js';
  if (!files[clientEntry]) {
    return {
      status: 400,
      body: { error: `missing client entry file: ${clientEntry}` },
    };
  }
  const serverEntry = manifest.entry.server;
  if (serverEntry && !files[serverEntry]) {
    return {
      status: 400,
      body: { error: `missing server entry file: ${serverEntry}` },
    };
  }

  const dir = join(PLUGINS_DIR, manifest.id, manifest.version);
  const allFiles: Record<string, string> = {
    'manifest.json': JSON.stringify(manifest),
    ...files,
  };
  for (const [name, content] of Object.entries(allFiles)) {
    if (name.includes('..') || name.startsWith('/')) continue;
    const filePath = join(dir, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  // Mark the bundle as ESM so node can import a `.js` server entry.
  if (!allFiles['package.json']) {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ type: 'module' })
    );
  }

  const entry: RegistryEntry = {
    id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    description: manifest.description,
    author: manifest.author,
    platforms: manifest.platforms,
    permissions: manifest.permissions,
    clientEntry,
    serverEntry,
    hasServer: Boolean(serverEntry),
    files: Object.keys(allFiles),
    status: AUTO_APPROVE ? 'approved' : 'pending',
    signature: signBundle(manifest, allFiles),
    publishedAt: Date.now(),
  };
  registry = registry.filter(
    e => !(e.id === entry.id && e.version === entry.version)
  );
  registry.push(entry);
  saveRegistry();
  return { status: 200, body: publicView(entry) };
}

// ---- seed bundled plugins ----
/**
 * Publishes every plugin found in {@link BUNDLED_PLUGINS_DIR} into the registry
 * on startup, so bundled first-party plugins are always listed without a manual
 * `plugin publish`. Re-published every start so source edits propagate (publish
 * overwrites the same version); the scaffolding template (unfilled
 * `__PLUGIN_*` placeholders) is skipped.
 */
function seedBundledPlugins() {
  if (!existsSync(BUNDLED_PLUGINS_DIR)) return;
  for (const dirent of readdirSync(BUNDLED_PLUGINS_DIR, {
    withFileTypes: true,
  })) {
    if (!dirent.isDirectory()) continue;
    const dir = join(BUNDLED_PLUGINS_DIR, dirent.name);
    const manifestPath = join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    const parsed = safeParseManifest(raw);
    if (!parsed.success) continue;
    const manifest = parsed.data;
    if (manifest.id.includes('__PLUGIN_')) continue;

    const files: Record<string, string> = {};
    let missing = false;
    for (const rel of [manifest.entry.client, manifest.entry.server]) {
      if (!rel) continue;
      const filePath = join(dir, rel);
      if (!existsSync(filePath)) {
        missing = true;
        break;
      }
      files[rel] = readFileSync(filePath, 'utf8');
    }
    if (missing) continue;

    const result = publish({ manifest: raw, files });
    if (result.status === 200) {
      console.log(
        `[plugin-server] seeded bundled plugin ${manifest.id}@${manifest.version}`
      );
    } else {
      console.warn(
        `[plugin-server] could not seed ${dirent.name}:`,
        JSON.stringify(result.body)
      );
    }
  }
}

// ---- download (serves manifest.json + bundle files for client import()) ----
function download(
  id: string,
  version: string,
  file: string
): { status: number; type: string; body: Buffer | string } {
  const base = join(PLUGINS_DIR, id, version);
  const filePath = join(base, file);
  if (
    file.includes('..') ||
    !filePath.startsWith(base) ||
    !existsSync(filePath)
  ) {
    return { status: 404, type: 'text/plain', body: 'not found' };
  }
  return { status: 200, type: contentType(file), body: readFileSync(filePath) };
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const { method } = req;

  if (method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'GET' && url.pathname === '/pubkey') {
    return sendJson(res, 200, { publicKey: keys.publicKey });
  }

  if (method === 'GET' && url.pathname === '/plugins') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const plugins = latestApprovedById()
      .filter(
        e =>
          !q ||
          e.name.toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q) ||
          (e.description ?? '').toLowerCase().includes(q)
      )
      .map(publicView);
    return sendJson(res, 200, { plugins });
  }

  if (method === 'GET' && parts[0] === 'plugins' && parts[1]) {
    const versions = registry.filter(e => e.id === parts[1]).map(publicView);
    if (!versions.length) return sendJson(res, 404, { error: 'not found' });
    return sendJson(res, 200, { id: parts[1], versions });
  }

  if (method === 'POST' && url.pathname === '/publish') {
    const body = (await readJsonBody(req)) as PublishBody;
    const result = publish(body);
    return sendJson(res, result.status, result.body);
  }

  // FaaS: invoke a plugin's server function.
  if (method === 'POST' && parts[0] === 'p' && parts.length === 3) {
    const [, id, fn] = parts;
    const entry = latestServerEntry(id);
    if (!entry?.serverEntry) {
      return sendJson(res, 404, { error: 'no server for plugin' });
    }
    const pluginReq: PluginRequest = {
      method: req.method ?? 'POST',
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k,
          Array.isArray(v) ? v.join(',') : (v ?? ''),
        ])
      ),
      query: Object.fromEntries(url.searchParams),
      body: await readJsonBody(req),
    };
    const result = await faas.invoke(
      entry.id,
      entry.version,
      entry.serverEntry,
      fn,
      pluginReq
    );
    return sendJson(res, 200, { result });
  }

  if (method === 'GET' && parts[0] === 'download' && parts.length >= 4) {
    const [, id, version, ...rest] = parts;
    const result = download(id, version, rest.join('/'));
    res.writeHead(result.status, { 'content-type': result.type, ...CORS });
    res.end(result.body);
    return;
  }

  // Curation scaffold (auto-approve is on by default; flip AUTO_APPROVE=false).
  if (method === 'POST' && parts[0] === 'admin' && parts.length === 4) {
    const [, id, version, action] = parts;
    const entry = registry.find(e => e.id === id && e.version === version);
    if (!entry) return sendJson(res, 404, { error: 'not found' });
    if (action === 'approve') entry.status = 'approved';
    else if (action === 'reject') entry.status = 'rejected';
    else return sendJson(res, 400, { error: 'bad action' });
    saveRegistry();
    return sendJson(res, 200, publicView(entry));
  }

  return sendJson(res, 404, { error: 'not found' });
}

seedBundledPlugins();

http
  .createServer((req, res) => {
    handle(req, res).catch(err => {
      console.error('[plugin-server]', err);
      sendJson(res, 500, { error: String(err) });
    });
  })
  .listen(PORT, () => {
    console.log(
      `[plugin-server] http://localhost:${PORT} (auto-approve: ${AUTO_APPROVE})`
    );
  });

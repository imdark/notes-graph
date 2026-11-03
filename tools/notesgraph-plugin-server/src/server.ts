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

import { type Developer, DeveloperStore, developerView } from './developers';
import { createFaas } from './faas';
import { type CallerUser, whoami } from './identity';
import {
  canonicalDigest,
  fileBytes,
  type SubmittedFile,
  verifyDeveloperSignature,
} from './signing';

const PORT = Number(process.env.PORT ?? 8099);
const DATA_DIR = process.env.PLUGIN_DATA_DIR ?? join(process.cwd(), 'data');
const PLUGINS_DIR = join(DATA_DIR, 'plugins');
const REGISTRY_FILE = join(DATA_DIR, 'registry.json');
const KEY_FILE = join(DATA_DIR, 'signing-key.json');
const DEVELOPERS_FILE = join(DATA_DIR, 'developers.json');
// The app, for asking who a signed-in caller is (identity.ts). In compose
// it is the server's service name; locally the dev server.
const APP_URL = process.env.NOTESGRAPH_URL ?? 'http://localhost:3010';
// The marketplace website (site/), served at / and /site/*.
const SITE_DIR =
  process.env.PLUGIN_SITE_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
/** Most a submission may weigh, all files together (base64 inflates by 4/3). */
const MAX_SUBMISSION_BYTES = 20 * 1024 * 1024;
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
  // The app's FetchService stamps every request with x-notesgraph-version, and
  // a header the preflight does not allow makes the browser block the request
  // outright — the symptom is a bare "Failed to fetch" with no status. Only
  // bites a cross-origin registry (a dev override, or a shared one): in prod
  // the marketplace is same-origin behind /market, so there is no preflight.
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, x-notesgraph-version',
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
  /**
   * Who submitted it and their signature over the canonical digest
   * (signing.ts); absent on bundled first-party plugins and on entries from
   * before developers existed.
   */
  developer?: {
    id: string;
    name: string;
    keyId: string;
    signature: string;
  };
  /** Why a reviewer rejected it, shown to its developer. */
  rejectedReason?: string;
  reviewedAt?: number;
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

function signBundle(
  manifest: unknown,
  files: Record<string, SubmittedFile>
): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(manifest));
  for (const name of Object.keys(files).sort()) {
    hash.update(name);
    hash.update(fileBytes(files[name]));
  }
  return cryptoSign(null, hash.digest(), keys.privateKey).toString('base64');
}

const developers = new DeveloperStore(DEVELOPERS_FILE);

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
    publishedAt: entry.publishedAt,
    downloadUrl: `/download/${entry.id}/${entry.version}`,
    ...(entry.developer
      ? {
          developer: {
            name: entry.developer.name,
            keyId: entry.developer.keyId,
          },
        }
      : {}),
  };
}

/** What a plugin's own developer and a reviewer see: the public view plus the files and the verdict. */
function ownerView(entry: RegistryEntry) {
  return {
    ...publicView(entry),
    files: entry.files,
    rejectedReason: entry.rejectedReason,
    reviewedAt: entry.reviewedAt,
  };
}

/** The developer who owns a plugin id: whoever published it first (trusted seeds own theirs). */
function ownerOf(id: string): string | null {
  const first = registry
    .filter(e => e.id === id)
    .sort((a, b) => a.publishedAt - b.publishedAt)[0];
  if (!first) return null;
  return first.developer?.id ?? 'notesgraph';
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
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  if (file.endsWith('.webp')) return 'image/webp';
  if (file.endsWith('.ico')) return 'image/x-icon';
  if (file.endsWith('.woff2')) return 'font/woff2';
  if (file.endsWith('.md') || file.endsWith('.txt'))
    return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

/** The marketplace website: GET / and GET /site/<file>, from SITE_DIR. */
function siteFile(path: string): {
  status: number;
  type: string;
  body: Buffer | string;
} {
  const rel =
    path === '/' || path === '' ? 'index.html' : path.replace(/^\/site\//, '');
  const filePath = join(SITE_DIR, rel);
  if (
    rel.includes('..') ||
    !filePath.startsWith(SITE_DIR) ||
    !existsSync(filePath)
  ) {
    return { status: 404, type: 'text/plain', body: 'not found' };
  }
  return { status: 200, type: contentType(rel), body: readFileSync(filePath) };
}

function parseFiles(value: unknown): Record<string, SubmittedFile> | string {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'files must be an object of path -> content';
  }
  const files: Record<string, SubmittedFile> = {};
  let total = 0;
  for (const [name, content] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) {
      return `bad file path: ${name}`;
    }
    if (typeof content === 'string') {
      files[name] = content;
      total += Buffer.byteLength(content, 'utf8');
    } else if (
      content &&
      typeof content === 'object' &&
      typeof (content as { base64?: unknown }).base64 === 'string'
    ) {
      files[name] = { base64: (content as { base64: string }).base64 };
      total += Math.ceil(
        ((content as { base64: string }).base64.length * 3) / 4
      );
    } else {
      return `file ${name} must be a string or { base64 }`;
    }
    if (total > MAX_SUBMISSION_BYTES) {
      return `submission is over ${MAX_SUBMISSION_BYTES / 1024 / 1024} MB`;
    }
  }
  return files;
}

// ---- publish ----
interface PublishBody {
  manifest?: unknown;
  files?: Record<string, SubmittedFile>;
  /** The developer's key and their signature over the canonical digest. */
  keyId?: unknown;
  signature?: unknown;
}

/**
 * Check a submission's developer signature: the caller must be a developer,
 * the key must be theirs, the signature must verify, and the id must be
 * theirs or unclaimed. Returns what to record on the entry, or an error.
 */
function checkSubmission(
  user: CallerUser,
  body: PublishBody,
  files: Record<string, SubmittedFile>,
  manifestId: string
):
  | { developer: RegistryEntry['developer'] }
  | { status: number; error: string } {
  const dev: Developer | undefined = developers.get(user.id);
  if (!dev) {
    return {
      status: 403,
      error: 'sign up as a developer and register a key first',
    };
  }
  const keyId = String(body.keyId ?? '');
  const key = dev.keys.find(k => k.keyId === keyId);
  if (!key) {
    return {
      status: 403,
      error: `key ${keyId || '(none)'} is not registered to you`,
    };
  }
  const digest = canonicalDigest(body.manifest, files);
  if (
    !verifyDeveloperSignature(
      Buffer.from(key.publicKey, 'base64'),
      digest,
      body.signature
    )
  ) {
    return {
      status: 403,
      error:
        'signature does not verify against your registered key: sign the exact manifest and files you are sending',
    };
  }
  const owner = ownerOf(manifestId);
  if (owner && owner !== user.id) {
    return {
      status: 403,
      error: `plugin id ${manifestId} belongs to another developer`,
    };
  }
  return {
    developer: {
      id: dev.id,
      name: dev.name,
      keyId,
      signature: String(body.signature),
    },
  };
}
/**
 * `trusted` marks a bundle that shipped inside this image rather than arriving
 * over the wire. Curation exists to hold *submissions* until a human looks at
 * them; a first-party plugin baked into the build has already been through
 * that, and leaving it `pending` under AUTO_APPROVE=false silently empties the
 * marketplace of exactly the plugins that are meant to always be there.
 */
function publish(
  body: PublishBody,
  {
    trusted = false,
    developer,
  }: { trusted?: boolean; developer?: RegistryEntry['developer'] } = {}
): { status: number; body: unknown } {
  const parsed = safeParseManifest(body.manifest);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: 'invalid manifest', issues: parsed.error.issues },
    };
  }
  const manifest = parsed.data;
  const files = body.files ?? {};
  // A submission is a new version; a seed overwrites its own on every boot.
  if (
    !trusted &&
    registry.some(e => e.id === manifest.id && e.version === manifest.version)
  ) {
    return {
      status: 409,
      body: {
        error: `${manifest.id}@${manifest.version} already exists; bump the version`,
      },
    };
  }
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
  const allFiles: Record<string, SubmittedFile> = {
    'manifest.json': JSON.stringify(manifest),
    ...files,
  };
  for (const [name, content] of Object.entries(allFiles)) {
    if (name.includes('..') || name.startsWith('/')) continue;
    const filePath = join(dir, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, fileBytes(content));
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
    status: AUTO_APPROVE || trusted ? 'approved' : 'pending',
    signature: signBundle(manifest, allFiles),
    publishedAt: Date.now(),
    ...(developer ? { developer } : {}),
  };
  registry = registry.filter(
    e => !(e.id === entry.id && e.version === entry.version)
  );
  registry.push(entry);
  saveRegistry();
  return { status: 200, body: ownerView(entry) };
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

    const result = publish({ manifest: raw, files }, { trusted: true });
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

  // The website.
  if (
    method === 'GET' &&
    (url.pathname === '/' || url.pathname.startsWith('/site/'))
  ) {
    const result = siteFile(url.pathname);
    res.writeHead(result.status, {
      'content-type': result.type,
      'cache-control':
        url.pathname === '/' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(result.body);
    return;
  }

  // Who is asking: null when the request carries no valid session.
  const caller = () => whoami(req, { appUrl: APP_URL });

  if (method === 'GET' && url.pathname === '/me') {
    const user = await caller();
    const dev = user ? developers.get(user.id) : undefined;
    return sendJson(res, 200, {
      user: user
        ? { id: user.id, name: user.name, email: user.email, admin: user.admin }
        : null,
      developer: dev ? developerView(dev) : null,
    });
  }

  if (method === 'POST' && url.pathname === '/developers') {
    const user = await caller();
    if (!user) return sendJson(res, 401, { error: 'sign in first' });
    const body = (await readJsonBody(req)) as {
      name?: unknown;
      publicKey?: unknown;
    };
    const result = developers.register(user, body);
    if ('error' in result) return sendJson(res, 400, { error: result.error });
    return sendJson(res, 200, { developer: developerView(result.developer) });
  }

  if (method === 'GET' && url.pathname === '/me/plugins') {
    const user = await caller();
    if (!user) return sendJson(res, 401, { error: 'sign in first' });
    const plugins = registry
      .filter(e => e.developer?.id === user.id)
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .map(ownerView);
    return sendJson(res, 200, { plugins });
  }

  if (method === 'GET' && url.pathname === '/admin/pending') {
    const user = await caller();
    if (!user) return sendJson(res, 401, { error: 'sign in first' });
    if (!user.admin) return sendJson(res, 403, { error: 'admins only' });
    const plugins = registry
      .filter(e => e.status === 'pending')
      .sort((a, b) => a.publishedAt - b.publishedAt)
      .map(ownerView);
    return sendJson(res, 200, { plugins });
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
    // Approved versions for everyone; the developer also sees their own
    // pending and rejected ones (an anonymous read never calls the app).
    const own = registry.some(e => e.id === parts[1] && e.status !== 'approved')
      ? await caller()
      : null;
    const versions = registry
      .filter(
        e =>
          e.id === parts[1] &&
          (e.status === 'approved' || (own && e.developer?.id === own.id))
      )
      .map(e =>
        own && e.developer?.id === own.id ? ownerView(e) : publicView(e)
      );
    if (!versions.length) return sendJson(res, 404, { error: 'not found' });
    return sendJson(res, 200, { id: parts[1], versions });
  }

  if (method === 'POST' && url.pathname === '/publish') {
    const user = await caller();
    if (!user) return sendJson(res, 401, { error: 'sign in first' });
    const body = (await readJsonBody(req)) as PublishBody;
    const files = parseFiles(body.files);
    if (typeof files === 'string') return sendJson(res, 400, { error: files });
    const manifestId = String(
      (body.manifest as { id?: unknown } | undefined)?.id ?? ''
    );
    const check = checkSubmission(user, body, files, manifestId);
    if ('error' in check)
      return sendJson(res, check.status, { error: check.error });
    const result = publish({ ...body, files }, { developer: check.developer });
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

  // Curation: a reviewer (an admin of the app) lists or decides a submission.
  if (method === 'POST' && parts[0] === 'admin' && parts.length === 4) {
    const user = await caller();
    if (!user) return sendJson(res, 401, { error: 'sign in first' });
    if (!user.admin) return sendJson(res, 403, { error: 'admins only' });
    const [, id, version, action] = parts;
    const entry = registry.find(e => e.id === id && e.version === version);
    if (!entry) return sendJson(res, 404, { error: 'not found' });
    const body = (await readJsonBody(req).catch(() => ({}))) as {
      reason?: unknown;
    };
    if (action === 'approve') {
      entry.status = 'approved';
      delete entry.rejectedReason;
    } else if (action === 'reject') {
      entry.status = 'rejected';
      const reason = String(body.reason ?? '')
        .trim()
        .slice(0, 2000);
      if (reason) entry.rejectedReason = reason;
    } else return sendJson(res, 400, { error: 'bad action' });
    entry.reviewedAt = Date.now();
    saveRegistry();
    return sendJson(res, 200, ownerView(entry));
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

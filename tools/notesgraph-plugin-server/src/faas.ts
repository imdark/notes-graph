import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  PluginRequest,
  PluginServerContext,
  PluginServerDefinition,
} from '@notesgraph/plugin-sdk/server';

/**
 * Minimal FaaS runtime: dynamic-imports a plugin's `server.js` and dispatches
 * its `functions`, with per-plugin fs-backed KV/blob/secrets.
 *
 * NOTE: v1 runs handlers in-process (no isolation). Running untrusted server
 * code requires real isolation (worker_threads/isolated-vm/container) before
 * an open/public backend — tracked as a hardening follow-up.
 *
 * TODO(plugin-db): give a backend plugin limited Postgres access.
 *
 * Today a plugin's server code gets fs-backed KV/blob/secrets and nothing
 * else, which is why anything with real data still has to be a *server*
 * plugin compiled into the app — machine inventory is the worked example:
 * `packages/backend/server/src/plugins/inventory` owns an `InventoryDevice`
 * table and its permission checks, while the marketplace plugin
 * `com.notesgraph.inventory` is only a UI that calls `/api/inventory`. That
 * split means a plugin author who needs to store more than a blob cannot
 * ship it through the marketplace at all.
 *
 * "Limited" is the whole design problem; the shape worth aiming at:
 *   - a schema (or table prefix) per plugin, created and migrated from the
 *     manifest, so a plugin can never read another's tables or the app's;
 *   - a connection role with rights only on that schema — no superuser, no
 *     access to `users`, `workspaces`, `snapshots`;
 *   - every row scoped to (plugin, workspace), enforced server-side rather
 *     than trusted from the handler, so a plugin cannot read across the
 *     workspaces it was installed into;
 *   - quotas (row count, storage, statement timeout) as a matter of course —
 *     this is a shared database and a plugin is untrusted code;
 *   - a migration story, since plugin versions come and go independently of
 *     the app's own migrations.
 *
 * Prerequisite, not optional: handler isolation (the NOTE above). Handing a
 * database connection to code running in-process in this sidecar would mean
 * any published plugin could reach the whole cluster. Isolation first, then
 * a scoped role, then this.
 */
export function createFaas(pluginsDir: string) {
  const defs = new Map<string, PluginServerDefinition>();

  async function loadDef(
    id: string,
    version: string,
    serverEntry: string
  ): Promise<PluginServerDefinition> {
    const key = `${id}@${version}`;
    const cached = defs.get(key);
    if (cached) return cached;
    const file = join(pluginsDir, id, version, serverEntry);
    const mod = (await import(pathToFileURL(file).href)) as {
      default?: PluginServerDefinition;
    };
    const def = mod.default ?? {};
    defs.set(key, def);
    return def;
  }

  function makeContext(id: string): PluginServerContext {
    const base = join(pluginsDir, id);
    const kvFile = join(base, 'kv.json');
    const blobDir = join(base, 'blob');
    const secretsFile = join(base, 'secrets.json');
    const readKv = (): Record<string, unknown> =>
      existsSync(kvFile)
        ? (JSON.parse(readFileSync(kvFile, 'utf8')) as Record<string, unknown>)
        : {};
    const writeKv = (obj: Record<string, unknown>) => {
      mkdirSync(base, { recursive: true });
      writeFileSync(kvFile, JSON.stringify(obj));
    };
    const blobPath = (key: string) => join(blobDir, encodeURIComponent(key));

    return {
      pluginId: id,
      kv: {
        get: key => Promise.resolve(readKv()[key]),
        set: (key, value) => {
          const obj = readKv();
          obj[key] = value;
          writeKv(obj);
          return Promise.resolve();
        },
        delete: key => {
          const obj = readKv();
          delete obj[key];
          writeKv(obj);
          return Promise.resolve();
        },
      },
      blob: {
        put: (key, data) => {
          mkdirSync(blobDir, { recursive: true });
          writeFileSync(blobPath(key), Buffer.from(data));
          return Promise.resolve();
        },
        get: key => {
          const file = blobPath(key);
          return Promise.resolve(
            existsSync(file) ? new Uint8Array(readFileSync(file)) : undefined
          );
        },
        delete: key => {
          const file = blobPath(key);
          if (existsSync(file)) rmSync(file);
          return Promise.resolve();
        },
      },
      secrets: existsSync(secretsFile)
        ? (JSON.parse(readFileSync(secretsFile, 'utf8')) as Record<
            string,
            string | undefined
          >)
        : {},
      fetch: (url, init) => fetch(url as string, init as RequestInit),
      log: (...args) => console.log(`[plugin:${id}]`, ...args),
    };
  }

  async function invoke(
    id: string,
    version: string,
    serverEntry: string,
    fn: string,
    req: PluginRequest
  ): Promise<unknown> {
    const def = await loadDef(id, version, serverEntry);
    const handler = def.functions?.[fn];
    if (!handler) throw new Error(`function not found: ${fn}`);
    return handler(req, makeContext(id));
  }

  return { invoke };
}

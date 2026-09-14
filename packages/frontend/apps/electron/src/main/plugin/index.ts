import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';

import { app, Notification, shell } from 'electron';

import type { NamespaceHandlers } from '../type';

/** Per-plugin storage dir under userData, sandboxed by a sanitized id. */
function pluginBaseDir(pluginId: string): string {
  const safe = pluginId.replace(/[^a-zA-Z0-9.-]/g, '_');
  return join(app.getPath('userData'), 'plugins', safe);
}

function resolveInPluginDir(pluginId: string, relativePath: string): string {
  const base = pluginBaseDir(pluginId);
  const full = join(base, relativePath);
  if (full !== base && !full.startsWith(base + sep)) {
    throw new Error('path escapes plugin directory');
  }
  return full;
}

/** Vetted native operations exposed to plugins via the `native` capability. */
export const pluginHandlers = {
  notify: async (_, title: string, body?: string) => {
    new Notification({ title, body }).show();
  },
  openExternal: async (_, url: string) => {
    await shell.openExternal(url);
  },
  fsRead: async (_, pluginId: string, path: string) => {
    const buf = await readFile(resolveInPluginDir(pluginId, path));
    return buf.toString('base64');
  },
  fsWrite: async (_, pluginId: string, path: string, dataBase64: string) => {
    const full = resolveInPluginDir(pluginId, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, Buffer.from(dataBase64, 'base64'));
  },
} satisfies NamespaceHandlers;

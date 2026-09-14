import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const APP_NAMES = [
  'NotesGraph',
  'NotesGraph Canary',
  'NotesGraph Beta',
  'notesgraph',
];

function appDataDirs(): string[] {
  const home = homedir();
  let bases: string[];
  if (process.platform === 'darwin') {
    bases = [join(home, 'Library', 'Application Support')];
  } else if (process.platform === 'win32') {
    bases = [process.env.APPDATA ?? join(home, 'AppData', 'Roaming')];
  } else {
    bases = [process.env.XDG_CONFIG_HOME ?? join(home, '.config')];
  }
  return bases.flatMap(base => APP_NAMES.map(name => join(base, name)));
}

function findStorageDbs(dir: string, depth: number, out: string[]) {
  if (depth < 0 || !existsSync(dir)) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (entry === 'storage.db') {
      out.push(full);
      continue;
    }
    try {
      if (statSync(full).isDirectory()) {
        findStorageDbs(full, depth - 1, out);
      }
    } catch {
      // unreadable entry — skip
    }
  }
}

/** Discover desktop nbstore `storage.db` files (workspaces/<peer>/<id>/…). */
export function discoverDbs(): string[] {
  const out: string[] = [];
  for (const dir of appDataDirs()) {
    findStorageDbs(join(dir, 'workspaces'), 3, out);
  }
  return out;
}

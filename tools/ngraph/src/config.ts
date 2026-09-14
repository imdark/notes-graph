import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CliConfig {
  server: string;
  token: string;
  workspace: string;
}

function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'ngraph', 'config.json');
}

export function loadConfig(): CliConfig | null {
  const path = configPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CliConfig;
  } catch {
    return null;
  }
}

/** Persist login config; the file holds a token, so restrict it to the user. */
export function saveConfig(config: CliConfig): string {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort on platforms without POSIX permissions
  }
  return path;
}

export function clearConfig(): boolean {
  const path = configPath();
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

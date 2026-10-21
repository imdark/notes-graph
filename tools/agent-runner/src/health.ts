/**
 * The cloud runner's answer to a health check. A Mac runs the check's shell
 * script (the server's HEALTH_SCRIPT); the cloud runner runs no shell from a
 * job, so it reads the same numbers itself and prints them in the script's
 * `key=value` lines, which the server grades the same way (healthStatus).
 */
import { readFile, statfs } from 'node:fs/promises';
import {
  cpus,
  freemem,
  hostname,
  loadavg,
  release,
  totalmem,
  type,
  uptime,
} from 'node:os';

import type { Job } from './api';

/** Health checks carry this agent id (the server's HEALTH_AGENT_PREFIX). */
const HEALTH_AGENT_PREFIX = 'health:';

export const isHealthCheck = (job: Job) =>
  job.model === 'command' && !!job.agentId?.startsWith(HEALTH_AGENT_PREFIX);

/** Percent of `path`'s filesystem used, as `df` counts it; null if unreadable. */
export async function diskUsed(path: string): Promise<number | null> {
  try {
    const fs = await statfs(path);
    const used = (fs.blocks - fs.bfree) * fs.bsize;
    const usable = used + fs.bavail * fs.bsize;
    return usable > 0 ? Math.ceil((used * 100) / usable) : null;
  } catch {
    return null;
  }
}

/** Percent of memory in use, from MemAvailable like the script; else from os. */
export async function memoryUsed(
  meminfo = '/proc/meminfo'
): Promise<number | null> {
  try {
    const text = await readFile(meminfo, 'utf8');
    const kb = (key: string) =>
      Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text)?.[1]);
    const total = kb('MemTotal');
    const available = kb('MemAvailable');
    if (total > 0 && Number.isFinite(available)) {
      return Math.floor(((total - available) * 100) / total);
    }
  } catch {
    // Not Linux: os has it.
  }
  const total = totalmem();
  return total > 0 ? Math.floor(((total - freemem()) * 100) / total) : null;
}

const days = (seconds: number) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const clock = `${h}:${String(m).padStart(2, '0')}`;
  return d > 0 ? `${d} day${d === 1 ? '' : 's'}, ${clock}` : clock;
};

/**
 * The check's output: host, system, CPUs, load, disk use of `/` and of the
 * runner's work folder when that is another filesystem, memory and uptime.
 */
export async function healthReading(workRoot?: string): Promise<string> {
  const lines = [`host=${hostname()}`, `os=${type()} ${release()}`];
  const cpuCount = cpus().length;
  if (cpuCount) lines.push(`cpus=${cpuCount}`);
  lines.push(`load=${loadavg()[0].toFixed(2)}`);
  // The work folder fills with job worktrees and mirrors: report the fuller
  // of it and `/`, which are one disk on most boxes.
  const disks = await Promise.all([
    diskUsed('/'),
    workRoot ? diskUsed(workRoot) : null,
  ]);
  const disk = Math.max(
    ...disks.filter((value): value is number => value !== null)
  );
  if (Number.isFinite(disk)) lines.push(`disk=${disk}`);
  const mem = await memoryUsed();
  if (mem !== null) lines.push(`mem=${mem}`);
  lines.push(`uptime=${days(uptime())}`);
  return lines.join('\n');
}

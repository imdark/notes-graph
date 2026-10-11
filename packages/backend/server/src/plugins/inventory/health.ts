import { Injectable, Logger, Optional } from '@nestjs/common';

import { BadRequest, EventBus, OnEvent } from '../../base';
import { Models } from '../../models';
import { InventoryJobService, type JobDto } from './jobs';
import { InventoryService } from './service';

/** Jobs of a health check carry this agent id, so their end is recognised. */
const HEALTH_AGENT_PREFIX = 'health:';

/**
 * What a health check runs on the machine: plain sh that works on Linux and
 * macOS, printing one `key=value` a line. A value it can't read is left out.
 */
export const HEALTH_SCRIPT = [
  'echo "host=$(hostname)"',
  'echo "os=$(uname -sr)"',
  'cpus=$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null)',
  '[ -n "$cpus" ] && echo "cpus=$cpus"',
  'if [ -r /proc/loadavg ]; then load=$(cut -d" " -f1 /proc/loadavg); else load=$(sysctl -n vm.loadavg 2>/dev/null | awk \'{print $2}\'); fi',
  '[ -n "$load" ] && echo "load=$load"',
  'disk=$(df -P / 2>/dev/null | awk \'NR==2 {gsub("%","",$5); print $5}\')',
  '[ -n "$disk" ] && echo "disk=$disk"',
  'if [ -r /proc/meminfo ]; then mem=$(awk \'/^MemTotal:/ {t=$2} /^MemAvailable:/ {a=$2} END {if (t) printf "%d", (t-a)*100/t}\' /proc/meminfo); else mem=$(memory_pressure 2>/dev/null | awk -F": " \'/free percentage/ {gsub("%","",$2); print 100-$2}\'); fi',
  '[ -n "$mem" ] && echo "mem=$mem"',
  'up=$(uptime 2>/dev/null | sed -E \'s/.*up +//; s/, +[0-9]+ users?.*//; s/, +load.*//\')',
  '[ -n "$up" ] && echo "uptime=$up"',
  'exit 0',
].join('\n');

/** Where the health output ends and the log lines begin. */
export const LOGS_MARKER = '---logs---';
/** Most a first scan reads back, when there is no last scan to start from. */
const FIRST_SCAN_SECONDS = 60 * 60;

/**
 * The health check, and for the monitoring agent the machine's warnings and
 * errors since `since` (epoch seconds) from the systemd journal. The worst
 * secrets are scrubbed on the machine, before the lines leave it; the server
 * redacts again (log-patterns.ts). A machine without journalctl sends none.
 */
export function healthScript(logsSince?: number | null) {
  if (logsSince === undefined || logsSince === null) return HEALTH_SCRIPT;
  const since = Math.floor(logsSince);
  const scrub = [
    String.raw`s#eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}#<jwt>#g`,
    String.raw`s#([Bb]earer|[Bb]asic) [A-Za-z0-9._~+/=-]+#\1 <token>#g`,
    String.raw`s#([Pp]ass(word|wd)?|PASS(WORD)?|[Ss]ecret|SECRET|[Tt]oken|TOKEN|[Aa]pi_?[Kk]ey|API_?KEY)([:=] ?)[^ ,;&]+#\1\4<redacted>#g`,
  ]
    .map(expression => `-e '${expression}'`)
    .join(' ');
  return [
    ...HEALTH_SCRIPT.split('\n').filter(line => line !== 'exit 0'),
    'if command -v journalctl >/dev/null 2>&1; then',
    '  until=$(date +%s)',
    `  echo "${LOGS_MARKER} $until"`,
    `  journalctl -q --no-pager -p warning -o short-iso --since "@${since}" --until "@$until" 2>/dev/null | tail -n 1000 | sed -E ${scrub}`,
    'fi',
    'exit 0',
  ].join('\n');
}

/**
 * The log lines a health check sent, and up to when they go; null when it
 * sent none (no agent, or no journal on the machine).
 */
export function healthLogs(output: string): { lines: string[]; until: number | null } | null {
  const at = output.indexOf(LOGS_MARKER);
  if (at < 0) return null;
  const [head, ...lines] = output.slice(at).split('\n');
  const until = Number(head.slice(LOGS_MARKER.length).trim());
  return {
    lines: lines.filter(line => line.trim()),
    until: Number.isFinite(until) && until > 0 ? until : null,
  };
}

/** When the next log scan of a machine should start reading from. */
export const logsSince = (scannedAt: Date | null | undefined, now = Date.now()) =>
  Math.floor((scannedAt?.getTime() ?? now - FIRST_SCAN_SECONDS * 1000) / 1000);

export type CheckStatus = 'ok' | 'warn' | 'fail';

/** One line of a health check, as the device's `checks` hold it. */
export interface HealthCheck {
  name: string;
  status: CheckStatus;
  value?: number;
  unit?: string;
  detail?: string;
}

/** Percent used, at or above which a check warns and fails. */
const THRESHOLDS = {
  disk: { warn: 85, fail: 95 },
  mem: { warn: 90, fail: 97 },
  /** Load per CPU. */
  load: { warn: 1.5, fail: 3 },
};

const grade = (value: number, { warn, fail }: { warn: number; fail: number }): CheckStatus =>
  value >= fail ? 'fail' : value >= warn ? 'warn' : 'ok';

/** The `key=value` lines the script printed. */
export function parseHealthOutput(output: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const match = /^([a-z]+)=(.*)$/.exec(line.trim());
    if (match && match[2].trim()) values[match[1]] = match[2].trim();
  }
  return values;
}

/**
 * The device status a check's output comes to: a check a line, and the
 * machine degraded if any of them isn't ok.
 */
export function healthStatus(output: string) {
  const at = output.indexOf(LOGS_MARKER);
  const values = parseHealthOutput(at < 0 ? output : output.slice(0, at));
  const checks: HealthCheck[] = [];
  const number = (key: string) => {
    const value = Number(values[key]);
    return values[key] !== undefined && Number.isFinite(value) ? value : null;
  };

  const disk = number('disk');
  if (disk !== null) {
    checks.push({ name: 'Disk', status: grade(disk, THRESHOLDS.disk), value: disk, unit: '%', detail: `${disk}% of / used` });
  }
  const mem = number('mem');
  if (mem !== null) {
    checks.push({ name: 'Memory', status: grade(mem, THRESHOLDS.mem), value: mem, unit: '%', detail: `${mem}% used` });
  }
  const load = number('load');
  if (load !== null) {
    const cpus = number('cpus') || 1;
    checks.push({
      name: 'Load',
      status: grade(load / cpus, THRESHOLDS.load),
      value: load,
      detail: `${load} over ${cpus} ${cpus === 1 ? 'CPU' : 'CPUs'}`,
    });
  }
  if (values.uptime) {
    checks.push({ name: 'Uptime', status: 'ok', detail: values.uptime });
  }
  if (values.os) {
    checks.push({ name: 'System', status: 'ok', detail: values.os });
  }

  const bad = checks.filter(check => check.status !== 'ok');
  return {
    state: checks.length === 0 ? 'unknown' : bad.length > 0 ? 'degraded' : 'online',
    statusDetail:
      checks.length === 0
        ? 'The health check printed nothing it could read'
        : bad.length > 0
          ? bad.map(check => `${check.name}: ${check.detail}`).join('; ')
          : null,
    checks,
  };
}

/** The status a check that didn't finish leaves: the machine couldn't say. */
export function failedHealthStatus(error: string | null) {
  const detail = (error || 'no output').slice(0, 500);
  return {
    state: 'degraded',
    statusDetail: `Health check failed: ${detail}`,
    checks: [{ name: 'Health check', status: 'fail', detail }] as HealthCheck[],
  };
}

/**
 * Health checks on inventory machines, asked for from the Monitoring page.
 *
 * A check is a device job like a monitor's command: queued here, run by the
 * machine's runner, and read back when it reports (`inventory.job.finished`),
 * so the status it records is the machine's own word, as fresh as the check.
 */
@Injectable()
export class InventoryHealthService {
  private readonly logger = new Logger(InventoryHealthService.name);

  constructor(
    private readonly models: Models,
    private readonly devices: InventoryService,
    private readonly jobs: InventoryJobService,
    @Optional() private readonly event?: EventBus
  ) {}

  /** Queue a check on `key`, unless one is already waiting to run there. */
  async check(workspaceId: string, userId: string, key: string): Promise<JobDto> {
    const device = await this.devices.get(workspaceId, key);
    if (!device) throw new BadRequest(`No device '${key}' in this workspace`);
    if (device.kind !== 'machine') throw new BadRequest('Only a machine can be health-checked');

    const waiting = (await this.jobs.list(workspaceId, key)).find(
      job =>
        job.agentId === HEALTH_AGENT_PREFIX + key &&
        (job.status === 'queued' || job.status === 'running')
    );
    if (waiting) return waiting;

    // With the monitoring agent on, the check also reads the logs since the last one.
    const agent = await this.models.monitoringAgent.get(workspaceId);
    const since = agent
      ? logsSince((await this.models.monitoringAgent.getLogCatalog(workspaceId, key))?.scannedAt)
      : null;

    return await this.jobs.enqueue(workspaceId, userId, key, {
      model: 'command',
      instructions: healthScript(since),
      agentId: HEALTH_AGENT_PREFIX + key,
      agentName: 'Health check',
      title: `Health check: ${device.name}`,
    });
  }

  /** Check every machine that takes jobs; the rest are reported as skipped. */
  async checkAll(workspaceId: string, userId: string) {
    const machines = await this.devices.list(workspaceId, { kind: 'machine' });
    const queued: string[] = [];
    const skipped: { key: string; reason: string }[] = [];
    for (const device of machines) {
      if (!device.agentTarget) {
        skipped.push({ key: device.key, reason: 'not an agent target' });
        continue;
      }
      try {
        await this.check(workspaceId, userId, device.key);
        queued.push(device.key);
      } catch (err) {
        skipped.push({ key: device.key, reason: (err as Error).message });
      }
    }
    return { queued, skipped };
  }

  /** A check finished: record what it found as the machine's status. */
  @OnEvent('inventory.job.finished')
  async onJobFinished(event: Events['inventory.job.finished']) {
    const job = await this.models.inventoryJob.get(event.workspaceId, event.jobId);
    if (!job?.agentId.startsWith(HEALTH_AGENT_PREFIX)) return;
    if (event.status === 'cancelled') return;
    try {
      const status =
        event.status === 'done'
          ? healthStatus(event.result ?? '')
          : failedHealthStatus(event.error);
      const device = await this.devices.get(event.workspaceId, job.deviceKey);
      if (!device) return;
      await this.devices.recordStatus(event.workspaceId, job.deviceKey, {
        ...status,
        // The version is what the deploy tooling put there; a check leaves it.
        version: device.version,
        checkedAt: Date.now() / 1000,
      });
      const logs = event.status === 'done' ? healthLogs(event.result ?? '') : null;
      if (logs) {
        this.event?.emit('inventory.device.logs', {
          workspaceId: event.workspaceId,
          key: job.deviceKey,
          lines: logs.lines,
          until: logs.until ?? Date.now() / 1000,
        });
      }
    } catch (err) {
      this.logger.warn(`health check ${event.jobId} could not be recorded: ${(err as Error).message}`);
    }
  }
}

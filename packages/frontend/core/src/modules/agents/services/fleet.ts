import { LiveData, Service } from '@notesgraph/infra';

import { FetchService, type WorkspaceServerService } from '../../cloud';
import type { FetchInit } from '../../cloud/services/fetch';
import type { WorkspaceService } from '../../workspace';

/**
 * The workspace's inventory machines and their health, for the Monitoring
 * page (see plugins/inventory on the server). A health check is a fixed
 * script the machine runs as a device job; its result becomes the device's
 * state and checks.
 */

export type DeviceState = 'online' | 'degraded' | 'offline' | 'unknown';

export const DEVICE_STATES: DeviceState[] = [
  'online',
  'degraded',
  'offline',
  'unknown',
];

export type CheckStatus = 'ok' | 'warn' | 'fail';

/** One line of a device's last health check. */
export interface DeviceCheck {
  name: string;
  status: CheckStatus;
  value?: number;
  unit?: string;
  detail?: string;
}

export interface InventoryDevice {
  key: string;
  name: string;
  kind: string;
  host: string;
  user: string;
  parentKey: string | null;
  path: string | null;
  recipe: string;
  channel: string;
  agentTarget: boolean;
  labels: Record<string, unknown>;
  state: string;
  statusDetail: string | null;
  version: string | null;
  /** Epoch seconds. */
  checkedAt: number | null;
  checks: unknown[];
  updatedAt: number;
}

/** How long a reading stays current; an older one is shown as stale. */
export const STALE_AFTER_SECONDS = 24 * 60 * 60;

const asState = (state: string): DeviceState =>
  (DEVICE_STATES as string[]).includes(state)
    ? (state as DeviceState)
    : 'unknown';

/** A device's state, unknown once its last check is too old to trust. */
export function deviceState(
  device: Pick<InventoryDevice, 'state' | 'checkedAt'>,
  nowSeconds: number
): DeviceState {
  if (!device.checkedAt) return 'unknown';
  if (nowSeconds - device.checkedAt > STALE_AFTER_SECONDS) return 'unknown';
  return asState(device.state);
}

/**
 * The checks as a list the page can show. The `wf` CLI writes its own shape,
 * so anything with a name is taken, and its status read loosely.
 */
export function deviceChecks(device: Pick<InventoryDevice, 'checks'>) {
  return device.checks.flatMap((raw): DeviceCheck[] => {
    if (!raw || typeof raw !== 'object') return [];
    const check = raw as Record<string, unknown>;
    const name = String(check.name ?? check.check ?? check.id ?? '').trim();
    if (!name) return [];
    const status = String(check.status ?? check.state ?? (check.ok === false ? 'fail' : 'ok')).toLowerCase();
    return [
      {
        name,
        status:
          status === 'fail' || status === 'failed' || status === 'error'
            ? 'fail'
            : status === 'warn' || status === 'warning' || status === 'degraded'
              ? 'warn'
              : 'ok',
        value: typeof check.value === 'number' ? check.value : undefined,
        unit: typeof check.unit === 'string' ? check.unit : undefined,
        detail:
          check.detail != null
            ? String(check.detail)
            : check.message != null
              ? String(check.message)
              : undefined,
      },
    ];
  });
}

/** How many machines are in each state. */
export function fleetSummary(
  devices: Pick<InventoryDevice, 'state' | 'checkedAt'>[],
  nowSeconds: number
): Record<DeviceState, number> {
  const counts: Record<DeviceState, number> = {
    online: 0,
    degraded: 0,
    offline: 0,
    unknown: 0,
  };
  for (const device of devices) counts[deviceState(device, nowSeconds)] += 1;
  return counts;
}

// ── monitoring agent ────────────────────────────────────────────────────
// It learns what's normal on each machine from its health checks, flags
// what's new, and escalates what matters (plugins/inventory/monitoring-agent
// on the server).

export type AgentMode = 'training' | 'shadow' | 'detect';

export const AGENT_MODES: { value: AgentMode; label: string; note: string }[] = [
  {
    value: 'training',
    label: 'Training',
    note: 'Learns what normal looks like on each machine. Flags nothing.',
  },
  {
    value: 'shadow',
    label: 'Shadow',
    note: 'Decides what it would escalate and logs it below, but tells nobody. Use it to see whether it can be trusted.',
  },
  {
    value: 'detect',
    label: 'Detect',
    note: 'Escalates what matters: a phone alert, and a read-only Claude triage on the machine if you turn it on.',
  },
];

/** Health checks a machine needs before the agent judges it (WARMUP on the server). */
export const AGENT_WARMUP = 10;

export interface MonitoringAgent {
  enabled: boolean;
  mode: AgentMode;
  sensitivity: number;
  intervalMinutes: number;
  autoTriage: boolean;
  alerts: { push: boolean };
  lastRunAt: number | null;
  nextRunAt: number | null;
  learning: {
    deviceKey: string;
    checks: number;
    metrics: { metric: string; mean: number; std: number; samples: number }[];
  }[];
}

export interface MonitoringDecision {
  id: string;
  deviceKey: string;
  metric: string;
  kind: 'anomaly' | 'new' | string;
  severity: 'warn' | 'critical' | string;
  value: number | null;
  baseline: number | null;
  score: number | null;
  summary: string;
  action: 'shadow' | 'escalated' | string;
  verdict: 'expected' | 'resolved' | null;
  triageJobId: string | null;
  triage: string | null;
  createdAt: number;
}

/** A shape of line a machine's logs have shown, with values as `<*>`. */
export interface LogPattern {
  id: string;
  template: string;
  example: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** Labelled known, or seen often enough to be part of normal. */
  known: boolean;
  label: 'known' | null;
  /** Usual lines an hour, and its spread. */
  perHour: number;
  std: number;
}

/** One machine's catalog of log patterns. */
export interface LogCatalog {
  deviceKey: string;
  scans: number;
  scannedAt: number | null;
  patterns: LogPattern[];
}

/** A decision about a log pattern carries this before the pattern's id. */
export const LOG_METRIC_PREFIX = 'log:';

export type AgentSettings = Partial<
  Pick<MonitoringAgent, 'mode' | 'sensitivity' | 'intervalMinutes' | 'autoTriage' | 'alerts'>
>;

/** How far along learning is: machines it can judge, of those it has seen. */
export function agentReadiness(agent: Pick<MonitoringAgent, 'learning'>) {
  const ready = agent.learning.filter(d => d.checks >= AGENT_WARMUP).length;
  return { ready, seen: agent.learning.length };
}

/** Decisions nobody has answered yet: escalated or shadowed, no verdict. */
export function openDecisions(decisions: MonitoringDecision[]) {
  return decisions.filter(d => !d.verdict);
}

/** How often the list is refreshed while something shows it. */
const REFRESH_MS = 30_000;
/** While a check is out, look this often, for at most CHECK_WAIT_MS. */
const CHECK_POLL_MS = 5_000;
const CHECK_WAIT_MS = 3 * 60_000;

export class FleetService extends Service {
  constructor(
    private readonly workspaceServerService: WorkspaceServerService,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
  }

  /** Every device in the workspace, machines and the folders on them. */
  readonly devices$ = new LiveData<InventoryDevice[]>([]);
  /** False until the first answer, or the first failure. */
  readonly loaded$ = new LiveData<boolean>(false);
  readonly error$ = new LiveData<string | null>(null);
  /** Machines with a check out, by key, and when it was asked for (ms). */
  readonly checking$ = new LiveData<Map<string, number>>(new Map());
  /** The monitoring agent; null until loaded, or where the server has none. */
  readonly agent$ = new LiveData<MonitoringAgent | null>(null);
  /** What it noticed, newest first. */
  readonly decisions$ = new LiveData<MonitoringDecision[]>([]);
  /** What each machine's logs normally say. */
  readonly logCatalogs$ = new LiveData<LogCatalog[]>([]);

  private timer: ReturnType<typeof setInterval> | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private watchers = 0;

  /** Keep the list fresh while something shows it; returns the stop. */
  watch(): () => void {
    this.watchers += 1;
    if (this.watchers === 1) {
      this.revalidate().catch(() => {});
      this.timer = setInterval(() => {
        this.revalidate().catch(() => {});
      }, REFRESH_MS);
    }
    return () => {
      this.watchers -= 1;
      if (this.watchers === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  override dispose() {
    if (this.timer) clearInterval(this.timer);
    if (this.checkTimer) clearInterval(this.checkTimer);
    super.dispose();
  }

  private get workspaceId(): string {
    const id = this.workspaceService.workspace?.id;
    if (!id) throw new Error('No workspace is open');
    return id;
  }

  private fetchService(): FetchService {
    const server = this.workspaceServerService.server;
    if (!server) {
      throw new Error('Machines are kept on a server, and this workspace is local.');
    }
    return server.scope.get(FetchService);
  }

  private async json<T>(path: string, init: FetchInit = {}): Promise<T> {
    const response = await this.fetchService().fetchRaw(
      `/api/inventory/workspaces/${encodeURIComponent(this.workspaceId)}${path}`,
      {
        ...init,
        headers: { 'Content-Type': 'application/json', ...init.headers },
      }
    );
    const text = await response.text();
    if (!response.ok) {
      let message = text.slice(0, 200);
      try {
        message = JSON.parse(text).message ?? message;
      } catch {
        if (response.status === 404) {
          message = 'This server has no machine inventory.';
        }
      }
      throw new Error(message);
    }
    return JSON.parse(text) as T;
  }

  async revalidate(): Promise<InventoryDevice[]> {
    try {
      const { devices } = await this.json<{ devices: InventoryDevice[] }>(
        '/devices'
      );
      this.devices$.setValue(devices);
      this.error$.setValue(null);
      this.settleChecks(devices);
      // The machines stand on their own; a server without the agent is fine.
      this.revalidateAgent().catch(() => {});
      return devices;
    } catch (err) {
      this.error$.setValue(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      this.loaded$.setValue(true);
    }
  }

  /** A check is settled once its machine reports after it was asked for. */
  private settleChecks(devices: InventoryDevice[]) {
    const checking = this.checking$.value;
    if (checking.size === 0) return;
    const now = Date.now();
    const next = new Map(checking);
    for (const [key, askedAt] of checking) {
      const device = devices.find(d => d.key === key);
      const reported = !!device?.checkedAt && device.checkedAt * 1000 >= askedAt;
      if (!device || reported || now - askedAt > CHECK_WAIT_MS) next.delete(key);
    }
    this.setChecking(next);
  }

  private setChecking(next: Map<string, number>) {
    this.checking$.setValue(next);
    if (next.size > 0 && !this.checkTimer) {
      this.checkTimer = setInterval(() => {
        this.revalidate().catch(() => {});
      }, CHECK_POLL_MS);
    } else if (next.size === 0 && this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  private markChecking(keys: string[]) {
    const next = new Map(this.checking$.value);
    // A second back: the machine's clock may be a little behind ours.
    const askedAt = Date.now() - 1000;
    for (const key of keys) next.set(key, askedAt);
    this.setChecking(next);
  }

  /** Run a health check on one machine; its status updates when it reports. */
  async check(key: string): Promise<void> {
    await this.json(`/devices/${encodeURIComponent(key)}/check`, {
      method: 'POST',
    });
    this.markChecking([key]);
  }

  async revalidateAgent(): Promise<void> {
    const [{ agent }, { decisions }] = await Promise.all([
      this.json<{ agent: MonitoringAgent }>('/monitoring-agent'),
      this.json<{ decisions: MonitoringDecision[] }>('/monitoring-agent/decisions?limit=50'),
    ]);
    this.agent$.setValue(agent);
    this.decisions$.setValue(decisions);
    // A server from before log patterns has no catalog; the rest still shows.
    this.revalidateLogs().catch(() => {});
  }

  async revalidateLogs(): Promise<void> {
    const { catalogs } = await this.json<{ catalogs: LogCatalog[] }>('/monitoring-agent/logs');
    this.logCatalogs$.setValue(catalogs);
  }

  /** "known": this pattern is never news; null: judge it again. */
  async labelPattern(deviceKey: string, patternId: string, label: 'known' | null): Promise<void> {
    const { pattern } = await this.json<{ pattern: LogPattern }>(
      `/monitoring-agent/logs/${encodeURIComponent(deviceKey)}/${encodeURIComponent(patternId)}/label`,
      { method: 'POST', body: JSON.stringify({ label }) }
    );
    this.logCatalogs$.setValue(
      this.logCatalogs$.value.map(catalog =>
        catalog.deviceKey === deviceKey
          ? { ...catalog, patterns: catalog.patterns.map(p => (p.id === pattern.id ? pattern : p)) }
          : catalog
      )
    );
  }

  /** Turn the agent on, or change its mode or settings. */
  async configureAgent(settings: AgentSettings): Promise<MonitoringAgent> {
    const { agent } = await this.json<{ agent: MonitoringAgent }>('/monitoring-agent', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
    this.agent$.setValue(agent);
    return agent;
  }

  /** Forget what it learned; it goes back to training. */
  async resetAgent(): Promise<void> {
    const { agent } = await this.json<{ agent: MonitoringAgent }>('/monitoring-agent/reset', {
      method: 'POST',
      body: '{}',
    });
    this.agent$.setValue(agent);
  }

  private replaceDecision(decision: MonitoringDecision) {
    this.decisions$.setValue(
      this.decisions$.value.map(d => (d.id === decision.id ? decision : d))
    );
  }

  /** Send a read-only Claude run to the machine to find out why. */
  async triage(decisionId: string): Promise<void> {
    const { decision } = await this.json<{ decision: MonitoringDecision }>(
      `/monitoring-agent/decisions/${encodeURIComponent(decisionId)}/triage`,
      { method: 'POST' }
    );
    this.replaceDecision(decision);
  }

  /** "expected" teaches it this is normal; "resolved" lets it alert again. */
  async feedback(decisionId: string, verdict: 'expected' | 'resolved'): Promise<void> {
    const { decision } = await this.json<{ decision: MonitoringDecision }>(
      `/monitoring-agent/decisions/${encodeURIComponent(decisionId)}/feedback`,
      { method: 'POST', body: JSON.stringify({ verdict }) }
    );
    this.replaceDecision(decision);
    // "expected" on a log finding labels its pattern known.
    if (decision.metric.startsWith(LOG_METRIC_PREFIX)) this.revalidateLogs().catch(() => {});
  }

  /** Check every machine that takes jobs; says which were skipped and why. */
  async checkAll(): Promise<{
    queued: string[];
    skipped: { key: string; reason: string }[];
  }> {
    const result = await this.json<{
      queued: string[];
      skipped: { key: string; reason: string }[];
    }>('/check', { method: 'POST' });
    this.markChecking(result.queued);
    return result;
  }
}

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

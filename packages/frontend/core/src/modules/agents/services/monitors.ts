import { LiveData, Service } from '@notesgraph/infra';

import { FetchService, type WorkspaceServerService } from '../../cloud';
import type { FetchInit } from '../../cloud/services/fetch';
import type { WorkspaceService } from '../../workspace';
import { monitorTrend, type Trend } from './monitor-trend';

/**
 * Monitors: the server watches something on a schedule and keeps a block up
 * to date with it (see plugins/monitor on the server). This is their client:
 * the list behind the block chip, the editor and the Agents page.
 */

export type MonitorKind = 'check' | 'agent';
export type MonitorSource = 'url' | 'command';
export type ExtractType = 'number' | 'regex' | 'jsonpath' | 'text';
export type ConditionType = 'change' | 'above' | 'below' | 'always';

export interface MonitorSpec {
  url?: string;
  command?: string;
  extract?: { type: ExtractType; pattern?: string };
  instructions?: string;
  model?: string;
  tools?: string[];
}

export interface MonitorAlerts {
  inApp?: boolean;
  push?: boolean;
  email?: boolean;
}

export interface MonitorCondition {
  type: ConditionType;
  value?: number;
}

export interface Monitor {
  id: string;
  name: string;
  docId: string;
  blockId: string;
  kind: MonitorKind;
  source: MonitorSource | null;
  deviceKey: string | null;
  spec: MonitorSpec;
  intervalMinutes: number;
  condition: MonitorCondition;
  alerts: MonitorAlerts;
  enabled: boolean;
  /** Epoch seconds. */
  nextRunAt: number;
  lastRunAt: number | null;
  lastValue: string | null;
  lastError: string | null;
  /** Waiting on a device job. */
  pending: boolean;
}

export type MonitorDraft = Pick<
  Monitor,
  | 'name'
  | 'docId'
  | 'blockId'
  | 'kind'
  | 'source'
  | 'deviceKey'
  | 'spec'
  | 'intervalMinutes'
  | 'condition'
  | 'alerts'
> & { enabled?: boolean };

export interface MonitorReading {
  value: string | null;
  error: string | null;
  changed: boolean;
  alerted: boolean;
  at: number;
}

/** The fastest a check and an agent may run, matching the server's limits. */
export const MIN_INTERVAL_MINUTES: Record<MonitorKind, number> = {
  check: 5,
  agent: 60,
};

/** How often the list is refreshed while something shows it. */
const REFRESH_MS = 60_000;

export class MonitorsService extends Service {
  constructor(
    private readonly workspaceServerService: WorkspaceServerService,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
  }

  /** The signed-in person's monitors in this workspace. */
  readonly monitors$ = new LiveData<Monitor[]>([]);
  /** Why the list couldn't be loaded (a local workspace, or an older server). */
  readonly error$ = new LiveData<string | null>(null);

  private timer: ReturnType<typeof setInterval> | null = null;
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

  /** Monitors writing into this block. */
  forBlock(docId: string, blockId: string): Monitor[] {
    return this.monitors$.value.filter(
      monitor => monitor.docId === docId && monitor.blockId === blockId
    );
  }

  private get workspaceId(): string {
    const id = this.workspaceService.workspace?.id;
    if (!id) throw new Error('No workspace is open');
    return id;
  }

  private fetchService(): FetchService {
    const server = this.workspaceServerService.server;
    if (!server) {
      throw new Error('Monitors run on a server, and this workspace is local.');
    }
    return server.scope.get(FetchService);
  }

  private async json<T>(path: string, init: FetchInit = {}): Promise<T> {
    const response = await this.fetchService().fetchRaw(
      `/api/workspaces/${this.workspaceId}/monitors${path}`,
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
        // Not JSON: an older server without monitors answers with its app page.
        if (response.status === 404) message = 'This server has no monitors yet.';
      }
      throw new Error(message);
    }
    return JSON.parse(text) as T;
  }

  async revalidate(): Promise<Monitor[]> {
    try {
      const { monitors } = await this.json<{ monitors: Monitor[] }>('/');
      this.monitors$.setValue(monitors);
      this.error$.setValue(null);
      return monitors;
    } catch (err) {
      this.error$.setValue(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private replace(monitor: Monitor) {
    const others = this.monitors$.value.filter(m => m.id !== monitor.id);
    this.monitors$.setValue([...others, monitor]);
  }

  async create(draft: MonitorDraft): Promise<Monitor> {
    const { monitor } = await this.json<{ monitor: Monitor }>('/', {
      method: 'POST',
      body: JSON.stringify(draft),
    });
    this.replace(monitor);
    return monitor;
  }

  async update(id: string, changes: Partial<MonitorDraft>): Promise<Monitor> {
    const { monitor } = await this.json<{ monitor: Monitor }>(`/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    });
    this.replace(monitor);
    return monitor;
  }

  async remove(id: string): Promise<void> {
    await this.json(`/${id}`, { method: 'DELETE' });
    this.monitors$.setValue(this.monitors$.value.filter(m => m.id !== id));
  }

  /** Run it now; the block and list update when the run lands. */
  async runNow(id: string): Promise<void> {
    await this.json(`/${id}/run`, { method: 'POST' });
    // A url check takes a few seconds; look again shortly after.
    setTimeout(() => this.revalidate().catch(() => {}), 5000);
  }

  async readings(id: string): Promise<MonitorReading[]> {
    const { readings } = await this.json<{ readings: MonitorReading[] }>(
      `/${id}/readings`
    );
    return readings;
  }

  /** Trends by monitor, kept until its next reading lands. */
  private readonly trends = new Map<
    string,
    { lastRunAt: number | null; trend: Promise<Trend | null> }
  >();

  /**
   * Its numeric readings over time, for the sparkline on its chip and card.
   * Fetched once per reading, however many places show it.
   */
  trend(monitor: Monitor): Promise<Trend | null> {
    const cached = this.trends.get(monitor.id);
    if (cached && cached.lastRunAt === monitor.lastRunAt) return cached.trend;
    const trend = this.readings(monitor.id)
      .then(monitorTrend)
      .catch(() => {
        // Try again next time rather than remembering the failure.
        this.trends.delete(monitor.id);
        return null;
      });
    this.trends.set(monitor.id, { lastRunAt: monitor.lastRunAt, trend });
    return trend;
  }

  /** Fetch and extract once without saving: the editor's "Test". */
  async test(spec: MonitorSpec): Promise<string> {
    const { value } = await this.json<{ value: string }>('/test', {
      method: 'POST',
      body: JSON.stringify({ spec }),
      timeout: 30_000,
    });
    return value;
  }
}

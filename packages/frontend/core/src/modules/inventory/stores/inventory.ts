import { UserFriendlyError } from '@notesgraph/error';
import { Store } from '@notesgraph/infra';

import type { FetchService } from '../../cloud';

/** Device kinds the inventory accepts. Mirrors the server's `DEVICE_KINDS`. */
export const DEVICE_KINDS = ['machine', 'folder'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** Health states, mirroring the server's `DEVICE_STATES`. */
export const DEVICE_STATES = ['online', 'degraded', 'offline', 'unknown'] as const;
export type DeviceState = (typeof DEVICE_STATES)[number];

/**
 * A device as `/api/inventory` returns it. `kind` and `state` stay strings
 * rather than the unions above: the server validates them, but it is the CLI
 * that writes most records, and an unknown value should render as itself
 * instead of breaking the list.
 */
export interface InventoryDevice {
  id: string;
  key: string;
  name: string;
  kind: string;
  host: string;
  user: string;
  port: number;
  parentKey: string | null;
  path: string | null;
  recipe: string;
  repo: string | null;
  branch: string;
  channel: string;
  pin: string | null;
  agentTarget: boolean;
  labels: Record<string, unknown>;
  state: string;
  statusDetail: string | null;
  version: string | null;
  /** Epoch seconds, as the CLI records them. */
  checkedAt: number | null;
  checks: unknown[];
  createdAt: number;
  updatedAt: number;
}

export interface RegisterDeviceInput {
  key?: string;
  name?: string;
  kind?: string;
  host?: string;
  user?: string;
  port?: number;
  parentKey?: string | null;
  path?: string | null;
  recipe?: string;
  repo?: string | null;
  branch?: string;
  channel?: string;
  pin?: string | null;
  agentTarget?: boolean;
  labels?: Record<string, unknown>;
}

/**
 * Thrown when the server has the inventory plugin compiled in but switched
 * off (`inventory.enabled`), which it answers with a 404 on every route. It
 * is a configuration state rather than a failure, so the UI reports it as
 * such instead of showing a network error.
 */
export class InventoryDisabledError extends Error {
  constructor() {
    super('The inventory API is not enabled on this server');
    this.name = 'InventoryDisabledError';
  }
}

export class InventoryStore extends Store {
  constructor(private readonly fetchService: FetchService) {
    super();
  }

  private async parse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = res.headers.get('Content-Type')?.startsWith('application/json')
        ? await res.json().catch(() => null)
        : await res.text().catch(() => null);
      throw UserFriendlyError.fromAny(body ?? res.statusText);
    }
    return (await res.json()) as T;
  }

  /**
   * The list route only 404s when the plugin is off — a workspace with no
   * devices answers 200 with an empty array — so a 404 here is unambiguous.
   */
  async listDevices(
    workspaceId: string,
    signal?: AbortSignal
  ): Promise<InventoryDevice[]> {
    const res = await this.fetchService.fetchRaw(
      `/api/inventory/workspaces/${encodeURIComponent(workspaceId)}/devices`,
      { signal, cache: 'no-store' }
    );
    if (res.status === 404) {
      throw new InventoryDisabledError();
    }
    const { devices } = await this.parse<{ devices: InventoryDevice[] }>(res);
    return devices;
  }

  /** Create or update a device. Idempotent on (workspace, key). */
  async registerDevice(
    workspaceId: string,
    input: RegisterDeviceInput,
    signal?: AbortSignal
  ): Promise<InventoryDevice> {
    const res = await this.fetchService.fetchRaw(
      `/api/inventory/workspaces/${encodeURIComponent(workspaceId)}/devices`,
      {
        method: 'POST',
        signal,
        body: JSON.stringify(input),
        headers: { 'content-type': 'application/json' },
      }
    );
    if (res.status === 404) {
      throw new InventoryDisabledError();
    }
    const { device } = await this.parse<{ device: InventoryDevice }>(res);
    return device;
  }

  async removeDevice(
    workspaceId: string,
    key: string,
    signal?: AbortSignal
  ): Promise<void> {
    const res = await this.fetchService.fetchRaw(
      `/api/inventory/workspaces/${encodeURIComponent(
        workspaceId
      )}/devices/${encodeURIComponent(key)}`,
      { method: 'DELETE', signal }
    );
    // A 404 here is ambiguous — plugin off, or the device is already gone.
    // Either way the caller's intent (that key should not exist) now holds.
    if (res.status === 404) {
      return;
    }
    await this.parse<{ ok: boolean; removed: number }>(res);
  }
}

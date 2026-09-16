import type { InventoryDevice } from '@prisma/client';

/** Device kinds the inventory accepts. */
export const DEVICE_KINDS = ['machine', 'folder'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** Health states, mirroring the `wf` CLI's registry vocabulary. */
export const DEVICE_STATES = ['online', 'degraded', 'offline', 'unknown'] as const;
export type DeviceState = (typeof DEVICE_STATES)[number];

export interface RegisterDeviceBody {
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

export interface DeviceStatusBody {
  state?: string;
  statusDetail?: string | null;
  version?: string | null;
  /** Epoch seconds, as the CLI records them. */
  checkedAt?: number | null;
  checks?: unknown[];
}

/** Wire shape returned to clients. */
export interface DeviceDto {
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
  checkedAt: number | null;
  checks: unknown[];
  createdAt: number;
  updatedAt: number;
}

export function toDeviceDto(device: InventoryDevice): DeviceDto {
  return {
    id: device.id,
    key: device.key,
    name: device.name,
    kind: device.kind,
    host: device.host,
    user: device.user,
    port: device.port,
    parentKey: device.parentKey,
    path: device.path,
    recipe: device.recipe,
    repo: device.repo,
    branch: device.branch,
    channel: device.channel,
    pin: device.pin,
    agentTarget: device.agentTarget,
    labels: (device.labels ?? {}) as Record<string, unknown>,
    state: device.state,
    statusDetail: device.statusDetail,
    version: device.version,
    // Epoch seconds both ways: the CLI speaks seconds, Prisma speaks Date.
    checkedAt: device.checkedAt ? device.checkedAt.getTime() / 1000 : null,
    checks: (device.checks ?? []) as unknown[],
    createdAt: device.createdAt.getTime() / 1000,
    updatedAt: device.updatedAt.getTime() / 1000,
  };
}

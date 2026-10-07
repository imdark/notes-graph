/**
 * @vitest-environment happy-dom
 */
import { WorkspaceServerService } from '@notesgraph/core/modules/cloud/services/workspace-server';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { Framework } from '@notesgraph/infra';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  deviceChecks,
  deviceState,
  FleetService,
  fleetSummary,
  type InventoryDevice,
  STALE_AFTER_SECONDS,
} from './fleet';

const NOW = 1_800_000_000;

const device = (over: Partial<InventoryDevice>): InventoryDevice => ({
  key: 'box',
  name: 'Box',
  kind: 'machine',
  host: 'box.local',
  user: 'me',
  parentKey: null,
  path: null,
  recipe: 'generic',
  channel: 'stable',
  agentTarget: true,
  labels: {},
  state: 'online',
  statusDetail: null,
  version: null,
  checkedAt: NOW - 60,
  checks: [],
  updatedAt: NOW,
  ...over,
});

/** A service over a fake server answering with `respond`. */
const setup = (respond: (path: string, init: any) => { status?: number; body: unknown }) => {
  const calls: { path: string; init: any }[] = [];
  const fetchService = {
    fetchRaw: async (path: string, init: any) => {
      calls.push({ path, init });
      const { status = 200, body } = respond(path, init);
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    },
  };
  const framework = new Framework();
  framework
    .service(WorkspaceServerService, {
      server: { scope: { get: () => fetchService } },
    } as any)
    .service(WorkspaceService, { workspace: { id: 'ws' } } as any)
    .service(FleetService, [WorkspaceServerService, WorkspaceService]);
  const service = framework.provider().get(FleetService);
  return { service, calls };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('fleet helpers', () => {
  test('a machine never checked, or checked too long ago, is unknown', () => {
    expect(deviceState(device({ checkedAt: null }), NOW)).toBe('unknown');
    expect(
      deviceState(device({ checkedAt: NOW - STALE_AFTER_SECONDS - 1 }), NOW)
    ).toBe('unknown');
    expect(deviceState(device({ state: 'degraded' }), NOW)).toBe('degraded');
    expect(deviceState(device({ state: 'weird' }), NOW)).toBe('unknown');
  });

  test('counts machines by state', () => {
    expect(
      fleetSummary(
        [
          device({}),
          device({ state: 'degraded' }),
          device({ state: 'offline' }),
          device({ checkedAt: null }),
          device({}),
        ],
        NOW
      )
    ).toEqual({ online: 2, degraded: 1, offline: 1, unknown: 1 });
  });

  test('reads both the server’s checks and the wf CLI’s', () => {
    expect(
      deviceChecks(
        device({
          checks: [
            { name: 'Disk', status: 'warn', value: 88, unit: '%', detail: '88% used' },
            { name: 'http', ok: false, detail: 'refused', duration_ms: 3 },
            { name: 'ssh', ok: true, detail: '' },
            { nothing: 'here' },
            null,
          ],
        })
      )
    ).toEqual([
      { name: 'Disk', status: 'warn', value: 88, unit: '%', detail: '88% used' },
      { name: 'http', status: 'fail', value: undefined, unit: undefined, detail: 'refused' },
      { name: 'ssh', status: 'ok', value: undefined, unit: undefined, detail: '' },
    ]);
  });
});

describe('FleetService', () => {
  test('lists the workspace’s devices', async () => {
    const { service, calls } = setup(() => ({ body: { devices: [device({})] } }));
    await service.revalidate();
    expect(calls[0].path).toBe('/api/inventory/workspaces/ws/devices');
    expect(service.devices$.value.map(d => d.key)).toEqual(['box']);
    expect(service.loaded$.value).toBe(true);
  });

  test('a check stays out until the machine reports after it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
    let checkedAt = NOW - 600;
    const { service, calls } = setup((_path, init) =>
      init.method === 'POST' ? { body: { job: { id: 'j1' } } } : { body: { devices: [device({ checkedAt })] } }
    );
    await service.check('box');
    expect(calls[0].path).toBe('/api/inventory/workspaces/ws/devices/box/check');
    expect(service.checking$.value.has('box')).toBe(true);

    await service.revalidate();
    expect(service.checking$.value.has('box')).toBe(true);

    checkedAt = NOW + 5;
    await service.revalidate();
    expect(service.checking$.value.size).toBe(0);
    service.dispose();
  });

  test('checking all marks the machines the server queued', async () => {
    const { service } = setup(() => ({
      body: { queued: ['a', 'b'], skipped: [{ key: 'c', reason: 'not an agent target' }] },
    }));
    const result = await service.checkAll();
    expect(result.skipped).toHaveLength(1);
    expect([...service.checking$.value.keys()]).toEqual(['a', 'b']);
    service.dispose();
  });

  test('a server without the inventory says so', async () => {
    const { service } = setup(() => ({ status: 404, body: '<!doctype html>' }));
    await expect(service.revalidate()).rejects.toThrow('This server has no machine inventory.');
    expect(service.loaded$.value).toBe(true);
  });
});

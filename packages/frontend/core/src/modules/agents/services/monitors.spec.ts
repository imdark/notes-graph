/**
 * @vitest-environment happy-dom
 */
import { WorkspaceServerService } from '@notesgraph/core/modules/cloud/services/workspace-server';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { Framework } from '@notesgraph/infra';
import { describe, expect, test } from 'vitest';

import { type Monitor, MonitorsService } from './monitors';

const monitor = (over: Partial<Monitor>): Monitor => ({
  id: 'm1',
  name: 'EUR',
  docId: 'doc',
  blockId: 'b1',
  kind: 'check',
  source: 'url',
  deviceKey: null,
  spec: { url: 'https://x' },
  intervalMinutes: 5,
  condition: { type: 'change' },
  alerts: { inApp: true },
  enabled: true,
  nextRunAt: 0,
  lastRunAt: null,
  lastValue: null,
  lastError: null,
  pending: false,
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
    .service(MonitorsService, [WorkspaceServerService, WorkspaceService]);
  const service = framework.provider().get(MonitorsService);
  return { service, calls };
};

describe('MonitorsService', () => {
  test('lists the workspace’s monitors and finds a block’s', async () => {
    const { service, calls } = setup(() => ({
      body: { monitors: [monitor({}), monitor({ id: 'm2', blockId: 'b2' })] },
    }));
    await service.revalidate();
    expect(calls[0].path).toBe('/api/workspaces/ws/monitors/');
    expect(service.forBlock('doc', 'b2').map(m => m.id)).toEqual(['m2']);
  });

  test('a saved monitor replaces its old copy in the list', async () => {
    const { service } = setup((_path, init) =>
      init.method === 'PATCH'
        ? { body: { monitor: monitor({ enabled: false }) } }
        : { body: { monitors: [monitor({})] } }
    );
    await service.revalidate();
    await service.update('m1', { enabled: false });
    expect(service.monitors$.value).toHaveLength(1);
    expect(service.monitors$.value[0].enabled).toBe(false);
  });

  test('the server’s reason comes through when a save is refused', async () => {
    const { service } = setup(() => ({
      status: 400,
      body: { message: 'A check runs at most every 5 minutes' },
    }));
    await expect(service.create(monitor({}) as any)).rejects.toThrow(
      'A check runs at most every 5 minutes'
    );
  });

  test('an older server without monitors says so instead of failing oddly', async () => {
    const { service } = setup(() => ({ status: 404, body: '<!doctype html>' }));
    await expect(service.revalidate()).rejects.toThrow('This server has no monitors yet.');
    expect(service.error$.value).toBe('This server has no monitors yet.');
  });

  test('the trend is fetched once per reading, however many ask', async () => {
    const reading = (value: string, at: number) => ({
      value,
      error: null,
      changed: false,
      alerted: false,
      at,
    });
    const { service, calls } = setup(() => ({
      body: { readings: [reading('3', 30), reading('1', 10)] },
    }));
    const first = await service.trend(monitor({ lastRunAt: 30 }));
    await service.trend(monitor({ lastRunAt: 30 }));
    expect(calls.map(c => c.path)).toEqual(['/api/workspaces/ws/monitors/m1/readings']);
    expect(first?.points.map(p => p.value)).toEqual([1, 3]);
    await service.trend(monitor({ lastRunAt: 40 }));
    expect(calls).toHaveLength(2);
  });
});

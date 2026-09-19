import { FetchService } from '@notesgraph/core/modules/cloud/services/fetch';
import {
  type InventoryDevice,
  InventoryDisabledError,
  InventoryStore,
} from '@notesgraph/core/modules/inventory/stores/inventory';
import { Framework } from '@notesgraph/infra';
import { describe, expect, test, vi } from 'vitest';

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const device = (over: Partial<InventoryDevice> = {}): InventoryDevice =>
  ({
    id: 'id-1',
    key: 'build-box',
    name: 'Build box',
    kind: 'machine',
    host: '10.0.0.4',
    user: 'ubuntu',
    port: 22,
    parentKey: null,
    path: null,
    recipe: 'generic',
    repo: null,
    branch: 'main',
    channel: 'stable',
    pin: null,
    agentTarget: false,
    labels: {},
    state: 'online',
    statusDetail: null,
    version: null,
    checkedAt: null,
    checks: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as InventoryDevice;

function createStore(
  fetchRaw: (input: string, init?: RequestInit) => Promise<Response>
) {
  const framework = new Framework();
  framework.service(FetchService, { fetchRaw } as any);
  framework.store(InventoryStore, [FetchService]);
  return framework.provider().get(InventoryStore);
}

describe('InventoryStore', () => {
  test('lists a workspace’s devices', async () => {
    const fetchRaw = vi.fn(async (_input: string, _init?: RequestInit) =>
      jsonResponse(200, { devices: [device()] })
    );
    const store = createStore(fetchRaw);

    const devices = await store.listDevices('ws-1');

    expect(devices).toHaveLength(1);
    expect(devices[0].key).toBe('build-box');
    expect(fetchRaw.mock.calls[0][0]).toBe(
      '/api/inventory/workspaces/ws-1/devices'
    );
  });

  test('reports a switched-off plugin as such, not as a failure', async () => {
    const store = createStore(async () =>
      jsonResponse(404, { message: 'Inventory API is not enabled on this server' })
    );

    await expect(store.listDevices('ws-1')).rejects.toBeInstanceOf(
      InventoryDisabledError
    );
  });

  test('surfaces other errors from the list route', async () => {
    const store = createStore(async () =>
      jsonResponse(403, { message: 'nope', type: 'NO_PERMISSION', name: 'X' })
    );

    await expect(store.listDevices('ws-1')).rejects.not.toBeInstanceOf(
      InventoryDisabledError
    );
  });

  test('registers a device as a JSON POST', async () => {
    const fetchRaw = vi.fn(async (_input: string, _init?: RequestInit) =>
      jsonResponse(200, { device: device({ key: 'new-box' }) })
    );
    const store = createStore(fetchRaw);

    const saved = await store.registerDevice('ws-1', { key: 'new-box' });

    expect(saved.key).toBe('new-box');
    const init = fetchRaw.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ key: 'new-box' });
  });

  test('escapes ids that would otherwise break out of the path', async () => {
    const fetchRaw = vi.fn(async (_input: string, _init?: RequestInit) =>
      jsonResponse(200, { ok: true, removed: 1 })
    );
    const store = createStore(fetchRaw);

    await store.removeDevice('ws/1', 'a b');

    expect(fetchRaw.mock.calls[0][0]).toBe(
      '/api/inventory/workspaces/ws%2F1/devices/a%20b'
    );
  });

  test('treats a missing device on delete as already gone', async () => {
    const store = createStore(async () => jsonResponse(404, { message: 'gone' }));

    await expect(store.removeDevice('ws-1', 'ghost')).resolves.toBeUndefined();
  });
});

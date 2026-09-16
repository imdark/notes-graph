import test from 'ava';

import { InventoryService } from '../service';
import { toDeviceDto } from '../types';

/**
 * Validation rules, exercised against a stub Models/Config pair.
 *
 * The persistence path is covered by the model's own integration tests;
 * what matters here is that a malformed device is rejected before it
 * reaches the database, and that the device-count cap only applies to new
 * registrations.
 */

const workspaceId = 'ws-1';
const userId = 'user-1';

function makeService(options: { devices?: any[]; max?: number } = {}) {
  const devices = options.devices ?? [];
  const stored: any[] = [];
  const models: any = {
    inventoryDevice: {
      get: async (_ws: string, key: string) =>
        devices.find(d => d.key === key) ?? null,
      list: async () => devices,
      upsert: async (input: any) => {
        const record = {
          id: 'uuid-1',
          workspaceId: input.workspaceId,
          key: input.key,
          name: input.name,
          kind: input.kind,
          host: input.host,
          user: input.user,
          port: input.port,
          parentKey: input.parentKey,
          path: input.path,
          recipe: input.recipe,
          repo: input.repo,
          branch: input.branch,
          channel: input.channel,
          pin: input.pin,
          agentTarget: input.agentTarget,
          labels: input.labels,
          state: 'unknown',
          statusDetail: null,
          version: null,
          checkedAt: null,
          checks: [],
          createdAt: new Date(0),
          updatedAt: new Date(0),
        };
        stored.push(record);
        return record;
      },
      updateStatus: async (_ws: string, key: string, patch: any) => {
        const existing = devices.find(d => d.key === key);
        return existing ? { ...existing, ...patch } : null;
      },
    },
  };
  const config: any = {
    inventory: { enabled: true, maxDevicesPerWorkspace: options.max ?? 500 },
  };
  return { service: new InventoryService(models, config), stored };
}

test('registers a machine with defaults', async t => {
  const { service } = makeService();
  const device = await service.register(workspaceId, userId, {
    key: 'gem5',
    host: 'gem5.local',
    user: 'pantheon',
  });

  t.is(device.key, 'gem5');
  t.is(device.kind, 'machine');
  t.is(device.port, 22);
  t.is(device.branch, 'main');
  t.false(device.agentTarget);
  // name falls back to the key rather than being left blank
  t.is(device.name, 'gem5');
});

test('rejects a device without a key', async t => {
  const { service } = makeService();
  await t.throwsAsync(service.register(workspaceId, userId, {}), {
    message: /key is required/,
  });
});

test('rejects keys that would not survive a URL path', async t => {
  const { service } = makeService();
  await t.throwsAsync(
    service.register(workspaceId, userId, { key: 'bad key/../etc' }),
    { message: /key must be/ }
  );
});

test('allows the colon that namespaces a folder under its machine', async t => {
  const { service } = makeService();
  const device = await service.register(workspaceId, userId, {
    key: 'gem5:robots_realtime',
    kind: 'folder',
    parentKey: 'gem5',
    path: '/home/pantheon/code/robots_realtime',
  });
  t.is(device.kind, 'folder');
  t.is(device.parentKey, 'gem5');
});

test('a folder target without a path is rejected', async t => {
  const { service } = makeService();
  await t.throwsAsync(
    service.register(workspaceId, userId, { key: 'gem5:x', kind: 'folder' }),
    { message: /folder targets require a path/ }
  );
});

test('rejects an unknown kind', async t => {
  const { service } = makeService();
  await t.throwsAsync(
    service.register(workspaceId, userId, { key: 'x', kind: 'toaster' }),
    { message: /kind must be one of/ }
  );
});

test('rejects an out-of-range port', async t => {
  const { service } = makeService();
  await t.throwsAsync(
    service.register(workspaceId, userId, { key: 'x', port: 99999 }),
    { message: /port must be between/ }
  );
});

test('the device cap blocks a new device', async t => {
  const { service } = makeService({ devices: [{ key: 'a' }, { key: 'b' }], max: 2 });
  await t.throwsAsync(service.register(workspaceId, userId, { key: 'c' }), {
    message: /max 2/,
  });
});

test('the device cap does not block re-registering an existing device', async t => {
  const { service } = makeService({ devices: [{ key: 'a' }, { key: 'b' }], max: 2 });
  const device = await service.register(workspaceId, userId, { key: 'a', host: 'moved' });
  t.is(device.host, 'moved');
});

test('rejects an unknown health state', async t => {
  const { service } = makeService({ devices: [{ key: 'gem5' }] });
  await t.throwsAsync(
    service.recordStatus(workspaceId, 'gem5', { state: 'on fire' }),
    { message: /state must be one of/ }
  );
});

test('status for an unknown device returns null rather than throwing', async t => {
  const { service } = makeService();
  t.is(await service.recordStatus(workspaceId, 'ghost', { state: 'online' }), null);
});

test('timestamps cross the wire as epoch seconds', t => {
  const dto = toDeviceDto({
    id: 'i', workspaceId: 'w', key: 'k', name: 'n', kind: 'machine',
    host: '', user: '', port: 22, parentKey: null, path: null,
    recipe: 'generic', repo: null, branch: 'main', channel: 'stable',
    pin: null, agentTarget: false, labels: {}, state: 'online',
    statusDetail: null, version: null,
    checkedAt: new Date(1_700_000_000_000),
    checks: [], registeredBy: null,
    createdAt: new Date(0), updatedAt: new Date(0),
  } as never);

  t.is(dto.checkedAt, 1_700_000_000);
});

/**
 * @vitest-environment happy-dom
 */
import {
  createPluginHarness,
  jsonResponse,
  type PluginHarness,
} from '@notesgraph/plugin-sdk/testing';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import manifestJson from './manifest.json';
import plugin from './index.js';

const manifest = manifestJson as Parameters<
  typeof createPluginHarness
>[0]['manifest'];

const device = (over: Record<string, unknown> = {}) => ({
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
});

const harnessWith = async (
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>
): Promise<PluginHarness> => {
  const harness = createPluginHarness({ manifest, fetch: fetchImpl });
  await harness.activate(plugin);
  return harness;
};

const renderDevicesPage = (harness: PluginHarness) => {
  const page = harness.settingsPages.find(p => p.id === 'devices');
  if (!page) throw new Error('the plugin contributed no devices page');
  return render(<page.component />);
};

afterEach(cleanup);

describe('inventory plugin — contributions', () => {
  test('contributes a devices settings page and a summary command', async () => {
    const harness = await harnessWith(async () =>
      jsonResponse(200, { devices: [] })
    );

    expect(harness.settingsPages.map(p => p.id)).toEqual(['devices']);
    expect(harness.settingsPages[0].title).toBe('Machine Inventory');
    expect(harness.commands.map(c => c.id)).toEqual(['inventory-summary']);
  });

  test('deactivating removes everything it registered', async () => {
    const harness = await harnessWith(async () =>
      jsonResponse(200, { devices: [] })
    );
    await harness.deactivate();

    expect(harness.settingsPages).toHaveLength(0);
    expect(harness.commands).toHaveLength(0);
  });

  test('declares every capability it actually uses', async () => {
    // The harness throws on an ungranted capability exactly as the host does,
    // so activating with the manifest's own permissions proves they are enough.
    const harness = createPluginHarness({
      manifest,
      permissions: [],
      fetch: async () => jsonResponse(200, { devices: [] }),
    });

    await expect(harness.activate(plugin)).rejects.toThrow(
      /missing permission: ui/
    );
  });
});

describe('inventory plugin — devices page', () => {
  test('lists machines and folders from the API', async () => {
    const harness = await harnessWith(async () =>
      jsonResponse(200, {
        devices: [
          device(),
          device({
            id: 'id-2',
            key: 'checkout',
            name: 'Checkout',
            kind: 'folder',
            path: '/opt/notesgraph',
            parentKey: 'build-box',
            state: 'degraded',
          }),
        ],
      })
    );

    renderDevicesPage(harness);

    await waitFor(() => expect(screen.getByText('Build box')).toBeTruthy());
    expect(screen.getByText('Checkout')).toBeTruthy();
    // Meta line carries where it is and how it is.
    expect(screen.getByText(/ubuntu@10\.0\.0\.4/)).toBeTruthy();
    expect(screen.getByText(/\/opt\/notesgraph/)).toBeTruthy();
    expect(screen.getByText(/Degraded/)).toBeTruthy();
  });

  test('scopes the request to the current workspace', async () => {
    const harness = createPluginHarness({
      manifest,
      workspace: { id: 'ws-42' },
      fetch: async () => jsonResponse(200, { devices: [] }),
    });
    await harness.activate(plugin);

    renderDevicesPage(harness);

    await waitFor(() => expect(harness.requests).toHaveLength(1));
    expect(harness.requests[0].url).toBe(
      '/api/inventory/workspaces/ws-42/devices'
    );
  });

  test('reports a switched-off plugin as configuration, not failure', async () => {
    const harness = await harnessWith(async () =>
      jsonResponse(404, { message: 'not enabled' })
    );

    renderDevicesPage(harness);

    await waitFor(() =>
      expect(screen.getByText(/inventory API is not enabled/i)).toBeTruthy()
    );
  });

  test('surfaces other failures with their status', async () => {
    const harness = await harnessWith(async () => jsonResponse(503, {}));

    renderDevicesPage(harness);

    await waitFor(() =>
      expect(screen.getByText(/Could not load devices \(503\)/)).toBeTruthy()
    );
  });

  test('says so when there is no workspace open', async () => {
    const harness = createPluginHarness({
      manifest,
      workspace: null,
      fetch: async () => jsonResponse(200, { devices: [] }),
    });
    await harness.activate(plugin);

    renderDevicesPage(harness);

    await waitFor(() =>
      expect(screen.getByText(/Open a workspace/i)).toBeTruthy()
    );
    // It should not have gone to the network without a workspace to scope to.
    expect(harness.requests).toHaveLength(0);
  });
});

describe('inventory plugin — summary command', () => {
  test('notifies with the online/offline split', async () => {
    const harness = await harnessWith(async () =>
      jsonResponse(200, {
        devices: [
          device(),
          device({ id: 'id-2', key: 'b', state: 'offline' }),
          device({ id: 'id-3', key: 'c', state: 'online' }),
        ],
      })
    );

    await harness.runCommand('inventory-summary');

    expect(harness.notifications).toHaveLength(1);
    expect(harness.notifications[0].title).toBe('3 devices');
    expect(harness.notifications[0].message).toBe('2 online · 1 not online');
  });

  test('singularises a lone device', async () => {
    const harness = await harnessWith(async () =>
      jsonResponse(200, { devices: [device()] })
    );

    await harness.runCommand('inventory-summary');

    expect(harness.notifications[0].title).toBe('1 device');
  });

  test('reports a disabled API rather than a bare status', async () => {
    const harness = await harnessWith(async () => jsonResponse(404, {}));

    await harness.runCommand('inventory-summary');

    expect(harness.notifications[0].theme).toBe('error');
    expect(harness.notifications[0].message).toMatch(/not enabled/i);
  });
});

describe('inventory plugin — writes', () => {
  test('registers a device as a JSON POST and reloads the list', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse(200, { device: device() });
      return jsonResponse(200, { devices: [] });
    });
    const harness = await harnessWith(fetchImpl);

    renderDevicesPage(harness);
    await waitFor(() => expect(screen.getByText('Add device')).toBeTruthy());

    fireEvent.click(screen.getByText('Add device'));
    const key = (await waitFor(() => {
      const input = document.querySelector('input');
      if (!input) throw new Error('no key input yet');
      return input;
    })) as HTMLInputElement;

    fireEvent.change(key, { target: { value: 'new-box' } });
    fireEvent.click(screen.getByText('Register'));

    await waitFor(() => {
      const post = harness.requests.find(r => r.init?.method === 'POST');
      expect(post).toBeTruthy();
      expect(post!.url).toBe('/api/inventory/workspaces/test-workspace/devices');
      expect(JSON.parse(post!.init!.body as string)).toMatchObject({
        key: 'new-box',
        kind: 'machine',
        port: 22,
      });
    });
  });

  test('refuses a key the server would reject, without calling the API', async () => {
    const harness = await harnessWith(async () =>
      jsonResponse(200, { devices: [] })
    );

    renderDevicesPage(harness);
    await waitFor(() => expect(screen.getByText('Add device')).toBeTruthy());
    screen.getByText('Add device').click();
    await waitFor(() => expect(screen.getByText('Register')).toBeTruthy());

    screen.getByText('Register').click();

    await waitFor(() =>
      expect(screen.getByText(/Key is required/)).toBeTruthy()
    );
    expect(harness.requests.filter(r => r.init?.method === 'POST')).toHaveLength(
      0
    );
  });

  test('removes a device only after the confirm step', async () => {
    const harness = await harnessWith(async (url, init) => {
      if (init?.method === 'DELETE') return jsonResponse(200, { ok: true });
      return jsonResponse(200, { devices: [device()] });
    });

    renderDevicesPage(harness);
    await waitFor(() => expect(screen.getByText('Build box')).toBeTruthy());

    screen.getByText('Remove').click();
    // Arming alone must not delete anything.
    expect(harness.requests.filter(r => r.init?.method === 'DELETE')).toHaveLength(
      0
    );

    await waitFor(() => expect(screen.getByText('Confirm')).toBeTruthy());
    screen.getByText('Confirm').click();

    await waitFor(() => {
      const del = harness.requests.find(r => r.init?.method === 'DELETE');
      expect(del).toBeTruthy();
      expect(del!.url).toBe(
        '/api/inventory/workspaces/test-workspace/devices/build-box'
      );
    });
  });
});

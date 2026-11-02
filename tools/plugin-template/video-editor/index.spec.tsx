/**
 * @vitest-environment happy-dom
 */
import {
  createPluginHarness,
  type PluginHarness,
} from '@notesgraph/plugin-sdk/testing';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import plugin from './index.js';
import manifestJson from './manifest.json';

type HarnessOptions = Parameters<typeof createPluginHarness>[0];
const manifest = manifestJson as HarnessOptions['manifest'];

const TEMPLATE = { id: 'video-editor', label: 'Video editor' };
const LAPTOP = { key: 'laptop', name: 'Laptop' };
const CLOUD = { key: 'cloud', name: 'Cloud (server)' };

const harnessWith = async (
  options: Partial<HarnessOptions> = {}
): Promise<PluginHarness> => {
  const harness = createPluginHarness({
    manifest,
    agents: { templates: [TEMPLATE], agents: [], devices: [LAPTOP] },
    ...options,
  } as HarnessOptions);
  await harness.activate(plugin);
  return harness;
};

const projectDoc = {
  id: 'doc-project',
  title: 'Video: launch',
  mode: 'page' as const,
};

afterEach(cleanup);

describe('video editor plugin — contributions', () => {
  test('contributes three commands and one panel', async () => {
    const harness = await harnessWith();
    expect(harness.commands.map(c => c.id)).toEqual([
      'video-editor:new-project',
      'video-editor:install-agent',
      'video-editor:edit-current',
    ]);
    expect(harness.sidebarPanels.map(p => p.id)).toEqual(['video-editor']);
  });

  test('deactivating removes everything it registered', async () => {
    const harness = await harnessWith();
    await harness.deactivate();
    expect(harness.commands).toHaveLength(0);
    expect(harness.sidebarPanels).toHaveLength(0);
  });

  test('declares every capability it actually uses', async () => {
    const harness = createPluginHarness({
      manifest,
      permissions: [],
      agents: { templates: [TEMPLATE], agents: [], devices: [LAPTOP] },
    } as HarnessOptions);
    await expect(harness.activate(plugin)).rejects.toThrow(
      /missing permission: ui/
    );
  });
});

describe('video editor plugin — new project', () => {
  test('creates the project note with its sections and says where to find it', async () => {
    const harness = await harnessWith();
    await harness.runCommand('video-editor:new-project');

    const docs = await harness.context.docs.list();
    expect(docs.map(d => d.title)).toEqual(['Video: new project']);
    expect(harness.notifications).toHaveLength(1);
    expect(harness.notifications[0].theme).toBe('success');
    expect(harness.notifications[0].title).toContain('Video: new project');
    expect(harness.notifications[0].message).toMatch(/All docs/);
  });
});

describe('video editor plugin — editing', () => {
  test('with no open note it asks for one instead of starting', async () => {
    const harness = await harnessWith();
    await harness.runCommand('video-editor:edit-current');

    expect(harness.startedRuns).toHaveLength(0);
    expect(harness.installedAgents).toHaveLength(0);
    expect(harness.notifications[0].theme).toBe('warning');
  });

  test('installs the agent once and starts a run on the open note', async () => {
    const harness = await harnessWith({ docs: [projectDoc] });
    await harness.runCommand('video-editor:edit-current');

    expect(harness.installedAgents).toHaveLength(1);
    expect(harness.installedAgents[0].model).toBe('video-editor');
    expect(harness.installedAgents[0].deviceKey).toBe('laptop');
    expect(harness.startedRuns).toEqual([
      {
        agentId: harness.installedAgents[0].id,
        target: { kind: 'doc', docId: 'doc-project' },
      },
    ]);
    expect(harness.notifications.some(n => n.title === 'Run started')).toBe(
      true
    );

    // A second edit reuses the installed agent.
    await harness.runCommand('video-editor:edit-current');
    expect(harness.installedAgents).toHaveLength(1);
    expect(harness.startedRuns).toHaveLength(2);
  });

  test('reuses an agent the workspace already has', async () => {
    const harness = await harnessWith({
      docs: [projectDoc],
      agents: {
        templates: [TEMPLATE],
        devices: [LAPTOP],
        agents: [
          {
            id: 'agent-existing',
            name: 'Video editor',
            model: 'video-editor',
            deviceKey: 'laptop',
            enabled: true,
          },
        ],
      },
    });
    await harness.runCommand('video-editor:edit-current');

    expect(harness.installedAgents).toHaveLength(0);
    expect(harness.startedRuns[0].agentId).toBe('agent-existing');
  });

  test('prefers a non-cloud device when none was chosen, and says so', async () => {
    const harness = await harnessWith({
      docs: [projectDoc],
      agents: {
        templates: [TEMPLATE],
        agents: [],
        devices: [CLOUD, LAPTOP],
      },
    });
    await harness.runCommand('video-editor:install-agent');

    expect(harness.installedAgents[0].deviceKey).toBe('laptop');
    expect(
      harness.notifications.some(n => n.title === 'Video editor runs on Laptop')
    ).toBe(true);
  });

  test('a device chosen in storage wins', async () => {
    const harness = await harnessWith({
      docs: [projectDoc],
      agents: {
        templates: [TEMPLATE],
        agents: [],
        devices: [CLOUD, LAPTOP],
      },
    });
    await harness.context.storage.set('deviceKey', 'cloud');
    await harness.runCommand('video-editor:install-agent');

    expect(harness.installedAgents[0].deviceKey).toBe('cloud');
    expect(harness.readStorage()).toEqual({ deviceKey: 'cloud' });
  });
});

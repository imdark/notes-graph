import { describe, expect, test } from 'vitest';

import type { PluginManifest } from './manifest';
import { createPluginHarness } from './testing';

/**
 * The harness's `agents` fake: what a plugin test relies on to check that a
 * plugin installs the agent it means to and starts it where it means to.
 */

const manifest: PluginManifest = {
  id: 'com.example.video',
  name: 'Video',
  version: '0.1.0',
  platforms: ['web'],
  permissions: ['agents'],
  entry: { client: 'index.js' },
};

const templates = [
  { id: 'video-editor', label: 'Video editor' },
  { id: 'research', label: 'Research' },
];

describe('plugin harness agents', () => {
  test('lists the seeded templates, agents and devices', async () => {
    const harness = createPluginHarness({
      manifest,
      agents: {
        templates,
        agents: [{ id: 'a0', name: 'Existing', enabled: true }],
        devices: [{ key: 'laptop', name: 'Laptop' }],
      },
    });
    expect(await harness.context.agents.listTemplates()).toEqual(templates);
    expect(await harness.context.agents.list()).toEqual([
      { id: 'a0', name: 'Existing', enabled: true },
    ]);
    expect(await harness.context.agents.listDevices()).toEqual([
      { key: 'laptop', name: 'Laptop' },
    ]);
  });

  test('installing a template once makes one agent; again hands it back', async () => {
    const harness = createPluginHarness({ manifest, agents: { templates } });
    const first = await harness.context.agents.installTemplate('video-editor', {
      deviceKey: 'laptop',
    });
    const second = await harness.context.agents.installTemplate('video-editor');
    expect(second).toBe(first);
    expect(first).toEqual({
      id: 'agent-1',
      name: 'Video editor',
      model: 'video-editor',
      deviceKey: 'laptop',
      enabled: true,
    });
    expect(harness.installedAgents).toEqual([first]);
    expect(await harness.context.agents.list()).toEqual([first]);
    // Any other template carries no harness model.
    const research = await harness.context.agents.installTemplate('research');
    expect(research.model).toBeUndefined();
  });

  test('an unknown template is an error naming the ones there are', async () => {
    const harness = createPluginHarness({ manifest, agents: { templates } });
    await expect(
      harness.context.agents.installTemplate('nope')
    ).rejects.toThrow(
      /no agent template 'nope' \(have: video-editor, research\)/
    );
  });

  test('starting a run is recorded; an unknown agent is an error', async () => {
    const harness = createPluginHarness({ manifest, agents: { templates } });
    const agent = await harness.context.agents.installTemplate('video-editor');
    await harness.context.agents.start(agent.id, {
      kind: 'doc',
      docId: 'doc-7',
    });
    expect(harness.startedRuns).toEqual([
      { agentId: 'agent-1', target: { kind: 'doc', docId: 'doc-7' } },
    ]);
    await expect(
      harness.context.agents.start('ghost', { kind: 'doc', docId: 'doc-7' })
    ).rejects.toThrow(/no agent 'ghost'/);
  });

  test('without the agents permission every call fails loudly', async () => {
    const harness = createPluginHarness({
      manifest,
      permissions: ['ui'],
      agents: { templates },
    });
    await expect(harness.context.agents.listTemplates()).rejects.toThrow(
      /missing permission: agents/
    );
    await expect(
      harness.context.agents.installTemplate('video-editor')
    ).rejects.toThrow(/missing permission: agents/);
  });
});

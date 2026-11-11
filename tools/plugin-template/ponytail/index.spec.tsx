import {
  createPluginHarness,
  type PluginHarness,
} from '@notesgraph/plugin-sdk/testing';
import { describe, expect, test } from 'vitest';

import plugin from './index.js';
import manifestJson from './manifest.json';

type HarnessOptions = Parameters<typeof createPluginHarness>[0];
const manifest = manifestJson as HarnessOptions['manifest'];

const TEMPLATE = { id: 'ponytail-review', label: 'Ponytail review' };
const LAPTOP = { key: 'laptop', name: 'Laptop' };
const CLOUD = { key: 'cloud', name: 'Cloud (server)' };
const taskDoc = { id: 'doc-task', title: 'Fix login', mode: 'page' as const };

const harnessWith = async (
  options: Partial<HarnessOptions> = {}
): Promise<PluginHarness> => {
  const harness = createPluginHarness({
    manifest,
    agents: { templates: [TEMPLATE], agents: [], devices: [CLOUD, LAPTOP] },
    ...options,
  } as HarnessOptions);
  await harness.activate(plugin);
  return harness;
};

describe('ponytail plugin', () => {
  test('contributes the review command', async () => {
    const harness = await harnessWith();
    expect(harness.commands.map(c => c.id)).toEqual([
      'ponytail:review-current',
    ]);
  });

  test('with no open note it asks for one instead of starting', async () => {
    const harness = await harnessWith();
    await harness.runCommand('ponytail:review-current');
    expect(harness.installedAgents).toHaveLength(0);
    expect(harness.startedRuns).toHaveLength(0);
    expect(harness.notifications[0].theme).toBe('warning');
  });

  test('installs the reviewer once, on a non-cloud device, and starts it on the open note', async () => {
    const harness = await harnessWith({ docs: [taskDoc] });
    await harness.runCommand('ponytail:review-current');
    await harness.runCommand('ponytail:review-current');

    expect(harness.installedAgents).toHaveLength(1);
    expect(harness.installedAgents[0].deviceKey).toBe('laptop');
    const target = { kind: 'doc', docId: 'doc-task' };
    const agentId = harness.installedAgents[0].id;
    expect(harness.startedRuns).toEqual([
      { agentId, target },
      { agentId, target },
    ]);
    expect(harness.notifications.at(-1)?.title).toBe('Review started');
  });

  test('declares every capability it uses', async () => {
    const harness = createPluginHarness({
      manifest,
      permissions: ['ui', 'docs'],
      agents: { templates: [TEMPLATE], agents: [], devices: [LAPTOP] },
      docs: [taskDoc],
    } as HarnessOptions);
    await harness.activate(plugin);
    await harness.runCommand('ponytail:review-current');
    expect(harness.notifications[0].theme).toBe('error');
    expect(harness.notifications[0].message).toMatch(
      /missing permission: agents/
    );
  });
});

/**
 * @vitest-environment happy-dom
 */
import type { RegistryDevice } from '@notesgraph/core/modules/agents';
import { describe, expect, test } from 'vitest';

import { checkFailure, hostFor, machineFailure } from './fix-it';

const device = (over: Partial<RegistryDevice> = {}): RegistryDevice => ({
  key: 'laptop',
  name: 'laptop',
  kind: 'machine',
  host: '',
  user: '',
  parentKey: null,
  path: null,
  recipe: 'generic',
  channel: 'stable',
  agentTarget: true,
  labels: {},
  state: 'degraded',
  statusDetail: 'Disk at 88%',
  version: null,
  checkedAt: null,
  checks: [],
  updatedAt: 0,
  ...over,
});

const cloud = device({ key: 'cloud', name: 'Cloud (server)' });
const prod = device({
  key: 'prod',
  name: 'prod',
  labels: { role: 'prod-host' },
});
const disk = { name: 'Disk', status: 'warn' as const, value: 88, unit: '%' };
const up = () => true;

describe('hostFor', () => {
  test('the prod-host machine this person may run on and that is up', () => {
    expect(hostFor([cloud, prod], up)?.key).toBe('prod');
    // An admin-only host reads as no job target to anyone else.
    expect(hostFor([cloud, { ...prod, agentTarget: false }], up)).toBeUndefined();
    expect(hostFor([cloud, prod], d => d.key !== 'prod')).toBeUndefined();
    expect(hostFor([cloud], up)).toBeUndefined();
  });
});

describe('a cloud runner failure', () => {
  test('is fixed on the server it runs on, which can reach Docker and its files', () => {
    const failure = checkFailure(cloud, disk, true, prod);
    expect(failure.deviceKey).toBe('prod');
    expect(failure.details.join('\n')).toMatch(
      /Run on prod \(prod\), the server this runner is on/
    );
    expect(machineFailure(cloud, 'degraded', true, prod).deviceKey).toBe(
      'prod'
    );
  });

  test('stays on the runner without a host, and another machine on itself', () => {
    expect(checkFailure(cloud, disk, true).deviceKey).toBe('cloud');
    expect(checkFailure(device(), disk, true, prod).deviceKey).toBe('laptop');
    expect(checkFailure(device(), disk, true, prod).details.join('\n')).not.toMatch(
      /Run on prod/
    );
  });
});

import { Button, notify } from '@notesgraph/component';
import {
  type DeviceCheck,
  FixTaskService,
  type HealthFailure,
  type Monitor,
  type RegistryDevice,
} from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useService } from '@notesgraph/infra';
import { useCallback, useState } from 'react';

const when = (seconds: number | null) =>
  seconds ? new Date(seconds * 1000).toLocaleString() : 'never';

const machineLine = (device: RegistryDevice) =>
  `Machine: ${device.name} (${device.key}${device.host ? `, ${device.user ? `${device.user}@` : ''}${device.host}` : ''})`;

/** Run it on the machine itself when it takes jobs and is reachable. */
const machineKey = (device: RegistryDevice, online: boolean) =>
  device.agentTarget && online ? device.key : undefined;

export const checkFailure = (
  device: RegistryDevice,
  check: DeviceCheck,
  online: boolean
): HealthFailure => ({
  title: `${check.name} ${check.status} on ${device.name}${check.detail ? `: ${check.detail}` : ''}`,
  details: [
    `Check: ${check.name}, status ${check.status}${check.value !== undefined ? `, reading ${check.value}${check.unit ?? ''}` : ''}.`,
    ...(check.detail ? [`Detail: ${check.detail}`] : []),
    `Checked: ${when(device.checkedAt)}.`,
    machineLine(device),
  ],
  deviceKey: machineKey(device, online),
});

export const machineFailure = (
  device: RegistryDevice,
  state: string,
  online: boolean
): HealthFailure => ({
  title: `${device.name} is ${state}${device.statusDetail ? `: ${device.statusDetail}` : ''}`,
  details: [
    `State: ${state}.`,
    ...(device.statusDetail ? [`Detail: ${device.statusDetail}`] : []),
    `Checked: ${when(device.checkedAt)}.`,
    machineLine(device),
  ],
  deviceKey: machineKey(device, online),
});

export const monitorFailure = (monitor: Monitor): HealthFailure => ({
  title: `${monitor.name} is failing: ${monitor.lastError ?? 'unknown error'}`,
  details: [
    `Error: ${monitor.lastError ?? 'unknown'}`,
    `Monitor: ${monitor.name} (${monitor.kind}${monitor.deviceKey ? ` on ${monitor.deviceKey}` : ''}${monitor.spec.url ? `, ${monitor.spec.url}` : ''}${monitor.spec.command ? `, command: ${monitor.spec.command}` : ''}).`,
    `Last run: ${when(monitor.lastRunAt)}.${monitor.lastValue ? ` Last good reading: ${monitor.lastValue}.` : ''}`,
  ],
  sourceDocId: monitor.docId,
  deviceKey: monitor.deviceKey ?? undefined,
});

/**
 * A failure's "Fix it": writes it as a to-do in the Fix-ups note and starts
 * the Fix it agent on it. The run asks before anything risky and waits under
 * "Needs you" when it is done.
 */
export const FixItButton = ({
  failure,
  label = 'Fix it',
}: {
  failure: HealthFailure;
  label?: string;
}) => {
  const fixTask = useService(FixTaskService);
  const workbench = useService(WorkbenchService).workbench;
  const [busy, setBusy] = useState(false);

  const fix = useCallback(() => {
    setBusy(true);
    fixTask
      .fix(failure)
      .then(({ docId, blockId }) =>
        notify.success({
          title: 'An agent is on it',
          message: `"${failure.title}" is a to-do in Fix-ups. It asks before anything risky; the Agents page shows the run.`,
          actions: [
            {
              key: 'open',
              label: 'Open the to-do',
              onClick: () =>
                workbench.openDoc(
                  { docId, mode: 'page', blockIds: [blockId] },
                  { at: 'active' }
                ),
              autoClose: true,
            },
          ],
        })
      )
      .catch(err =>
        notify.error({
          title: "Couldn't start the fix",
          message: err instanceof Error ? err.message : String(err),
        })
      )
      .finally(() => setBusy(false));
  }, [failure, fixTask, workbench]);

  return (
    <Button
      variant="plain"
      onClick={e => {
        // Rows it sits in open on click; the fix is its own action.
        e.stopPropagation();
        fix();
      }}
      loading={busy}
      disabled={busy}
      tooltip="Make this a to-do in Fix-ups and start an agent on it. It asks before anything risky."
      data-testid="health-fix-it"
    >
      {label}
    </Button>
  );
};

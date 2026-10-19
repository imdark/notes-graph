import { Button, notify } from '@notesgraph/component';
import { AgentRunLogDialog } from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/agent-run-log';
import {
  AgentRunsStore,
  type DeviceCheck,
  fixKey,
  FixTaskService,
  type HealthFailure,
  type Monitor,
  type RegistryDevice,
} from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

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
 * A failure's "Fix it": writes it as a to-do in the Fix-ups note, starts the
 * Fix it agent on it and opens the run's window: its log as it goes, the
 * questions it asks and a box to tell it more. While a fix is on, "Show
 * agent" beside it opens that window again.
 */
export const FixItButton = ({
  failure,
  label = 'Fix it',
}: {
  failure: HealthFailure;
  label?: string;
}) => {
  const fixTask = useService(FixTaskService);
  const runsStore = useService(AgentRunsStore);
  const workbench = useService(WorkbenchService).workbench;
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  // Failures are rebuilt on every render; the same one is the same fix.
  const key = fixKey(failure);
  const started = useLiveData(
    useMemo(() => fixTask.watchFix(key), [fixTask, key])
  );
  const run = useLiveData(
    useMemo(
      () => (started?.runId ? runsStore.watchRun(started.runId) : null),
      [runsStore, started?.runId]
    )
  );
  const fixing = run?.status === 'running';

  const openTodo = useCallback(
    (docId: string, blockId: string) =>
      workbench.openDoc(
        { docId, mode: 'page', blockIds: [blockId] },
        { at: 'active' }
      ),
    [workbench]
  );

  const fix = useCallback(() => {
    setBusy(true);
    fixTask
      .fix(failure)
      .then(({ docId, blockId, runId }) => {
        if (runId) {
          setOpen(true);
          return;
        }
        // No record yet to open: say where the work is instead.
        notify.success({
          title: 'An agent is on it',
          message: `"${failure.title}" is a to-do in Fix-ups. It asks before anything risky; the Agents page shows the run.`,
          actions: [
            {
              key: 'open',
              label: 'Open the to-do',
              onClick: () => openTodo(docId, blockId),
              autoClose: true,
            },
          ],
        });
      })
      .catch(err =>
        notify.error({
          title: "Couldn't start the fix",
          message: err instanceof Error ? err.message : String(err),
        })
      )
      .finally(() => setBusy(false));
  }, [failure, fixTask, openTodo]);

  return (
    // Rows it sits in open on click, and React events bubble out of the
    // window's portal too: the fix and its window are their own actions.
    <span
      style={{ display: 'inline-flex', gap: 4 }}
      onClick={e => e.stopPropagation()}
    >
      <Button
        variant="plain"
        onClick={fix}
        loading={busy}
        disabled={busy || fixing}
        tooltip={
          fixing
            ? 'An agent is already working on this.'
            : 'Make this a to-do in Fix-ups and start an agent on it. It asks before anything risky.'
        }
        data-testid="health-fix-it"
      >
        {fixing ? 'Fixing…' : label}
      </Button>
      {run ? (
        <Button
          variant="plain"
          onClick={() => setOpen(true)}
          tooltip={
            fixing
              ? 'Watch the agent fixing this, answer it or tell it more.'
              : 'What the agent found and did.'
          }
          data-testid="health-fix-show-agent"
        >
          Show agent
        </Button>
      ) : null}
      {started?.runId ? (
        <AgentRunLogDialog
          runId={open ? started.runId : null}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </span>
  );
};

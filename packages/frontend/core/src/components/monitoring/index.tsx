import { Button, notify } from '@notesgraph/component';
import {
  type DeviceCheck,
  deviceChecks,
  type DeviceState,
  deviceState,
  FleetService,
  fleetSummary,
  formatTrendValue,
  type InventoryDevice,
  type Monitor,
  MonitorsService,
  sparklinePath,
  type Trend,
} from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { cssVar } from '@toeverything/theme';
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as styles from './styles.css';

type Filter = 'all' | 'attention' | DeviceState;

const STATE_LABEL: Record<DeviceState, string> = {
  online: 'Online',
  degraded: 'Degraded',
  offline: 'Offline',
  unknown: 'Not checked',
};

/** Seconds, so it lines up with the server's epoch-second times. */
const useNow = () => {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
};

const ago = (seconds: number, now: number) => {
  const diff = Math.max(0, now - seconds);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** A percentage reads best as a bar; anything else as its detail. */
const CheckRow = ({ check }: { check: DeviceCheck }) => (
  <div className={styles.check} title={check.detail}>
    <span className={styles.dot} data-state={check.status} />
    <span className={styles.checkName}>{check.name}</span>
    {check.unit === '%' && check.value !== undefined ? (
      <span className={styles.meter}>
        <span className={styles.meterTrack}>
          <span
            className={styles.meterFill}
            data-state={check.status}
            style={{ width: `${Math.min(100, Math.max(0, check.value))}%` }}
          />
        </span>
        <span className={styles.meterValue}>{check.value}%</span>
      </span>
    ) : (
      <span className={styles.checkDetail}>
        {check.detail || (check.status === 'ok' ? 'OK' : 'Failed')}
      </span>
    )}
  </div>
);

const SPARK_WIDTH = 64;
const SPARK_HEIGHT = 16;

/** A monitor's numeric readings over time, small enough for a row. */
const Sparkline = ({ monitor }: { monitor: Monitor }) => {
  const monitorsService = useService(MonitorsService);
  const [trend, setTrend] = useState<Trend | null>(null);
  useEffect(() => {
    let live = true;
    monitorsService
      .trend(monitor)
      .then(next => live && setTrend(next))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [monitorsService, monitor]);
  if (!trend) return null;
  return (
    <svg
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      style={{ color: cssVar('primaryColor'), flexShrink: 0 }}
      aria-label={`${trend.points.length} readings, ${formatTrendValue(trend.min)} to ${formatTrendValue(trend.max)}`}
    >
      <path
        d={sparklinePath(trend, SPARK_WIDTH, SPARK_HEIGHT, 1.5)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

const MonitorRow = ({
  monitor,
  now,
  onOpen,
}: {
  monitor: Monitor;
  now: number;
  onOpen: (monitor: Monitor) => void;
}) => {
  const state = !monitor.enabled
    ? 'unknown'
    : monitor.lastError
      ? 'fail'
      : monitor.lastValue !== null
        ? 'ok'
        : 'unknown';
  return (
    <button
      className={styles.monitorRow}
      onClick={() => onOpen(monitor)}
      title={monitor.lastError ?? `Open the block ${monitor.name} keeps up to date`}
      data-testid="monitoring-monitor"
    >
      <span className={styles.dot} data-state={state} />
      <span className={styles.monitorName}>{monitor.name}</span>
      <span className={styles.monitorValue}>
        {!monitor.enabled
          ? 'Paused'
          : monitor.pending
            ? 'Running…'
            : monitor.lastError
              ? monitor.lastError
              : monitor.lastValue !== null
                ? `${monitor.lastValue}${monitor.lastRunAt ? ` · ${ago(monitor.lastRunAt, now)}` : ''}`
                : 'No reading yet'}
      </span>
      <Sparkline monitor={monitor} />
    </button>
  );
};

const MachineCard = ({
  device,
  folders,
  monitors,
  checking,
  now,
  onOpenMonitor,
}: {
  device: InventoryDevice;
  folders: InventoryDevice[];
  monitors: Monitor[];
  checking: boolean;
  now: number;
  onOpenMonitor: (monitor: Monitor) => void;
}) => {
  const fleet = useService(FleetService);
  const monitorsService = useService(MonitorsService);
  const state = deviceState(device, now);
  const checks = deviceChecks(device);
  const address = device.host
    ? `${device.user ? `${device.user}@` : ''}${device.host}`
    : device.key;

  const check = useCallback(() => {
    fleet.check(device.key).catch(err => {
      notify.error({ title: `Couldn't check ${device.name}`, message: errorMessage(err) });
    });
  }, [device, fleet]);

  const runMonitors = useCallback(() => {
    Promise.all(monitors.map(m => monitorsService.runNow(m.id)))
      .then(() =>
        notify.success({
          title: `Running ${monitors.length} ${monitors.length === 1 ? 'monitor' : 'monitors'} on ${device.name}`,
        })
      )
      .catch(err => {
        notify.error({ title: 'Monitor', message: errorMessage(err) });
      });
  }, [device, monitors, monitorsService]);

  return (
    <div className={styles.card} data-testid="monitoring-machine">
      <div className={styles.cardHead}>
        <span className={styles.dot} data-state={state} />
        <span className={styles.cardName} title={device.key}>
          {device.name}
        </span>
        {checking ? <span className={styles.pill}>Checking…</span> : null}
        <span className={styles.pill}>{STATE_LABEL[state]}</span>
      </div>
      <span className={styles.meta} title={address}>
        {address}
        {device.version ? ` · ${device.version}` : ''}
        {folders.length > 0
          ? ` · ${folders.length} ${folders.length === 1 ? 'folder' : 'folders'}`
          : ''}
      </span>
      <span className={styles.meta}>
        {device.checkedAt
          ? `Checked ${ago(device.checkedAt, now)}`
          : 'Never checked'}
        {device.checkedAt && state === 'unknown' ? ' · too long ago to trust' : ''}
      </span>
      {device.statusDetail && state !== 'online' ? (
        <span className={styles.problem}>{device.statusDetail}</span>
      ) : null}
      {checks.length > 0 ? (
        <div className={styles.checks}>
          {checks.map(c => (
            <CheckRow key={c.name} check={c} />
          ))}
        </div>
      ) : null}
      {monitors.length > 0 ? (
        <div className={styles.monitors}>
          {monitors.map(monitor => (
            <MonitorRow
              key={monitor.id}
              monitor={monitor}
              now={now}
              onOpen={onOpenMonitor}
            />
          ))}
        </div>
      ) : null}
      <div className={styles.actions}>
        <Button
          onClick={check}
          disabled={!device.agentTarget || checking}
          tooltip={
            device.agentTarget
              ? 'Run a health check on this machine: load, disk and memory'
              : 'This machine doesn’t take jobs. Re-register it with agent execution allowed to check it from here.'
          }
          data-testid="monitoring-check"
        >
          {checking ? 'Checking…' : 'Check now'}
        </Button>
        {monitors.length > 0 ? (
          <Button onClick={runMonitors} data-testid="monitoring-run-monitors">
            Run monitors ({monitors.length})
          </Button>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Monitoring: the workspace's inventory machines at a glance — their health
 * from the last check, the monitors that run on each, and a way to check one
 * machine or all of them now. Monitors not on a machine (website checks,
 * which the server runs) are listed after.
 */
export const MonitoringView = () => {
  const fleet = useService(FleetService);
  const monitorsService = useService(MonitorsService);
  const workbench = useService(WorkbenchService).workbench;
  const now = useNow();

  const devices = useLiveData(fleet.devices$);
  const loaded = useLiveData(fleet.loaded$);
  const error = useLiveData(fleet.error$);
  const checking = useLiveData(fleet.checking$);
  const monitors = useLiveData(monitorsService.monitors$);

  useEffect(() => fleet.watch(), [fleet]);
  useEffect(() => monitorsService.watch(), [monitorsService]);

  const [filter, setFilter] = useState<Filter>('all');

  const machines = useMemo(
    () =>
      devices
        .filter(device => device.kind === 'machine')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [devices]
  );
  const summary = useMemo(() => fleetSummary(machines, now), [machines, now]);
  const attention = summary.degraded + summary.offline + summary.unknown;

  /** A machine's monitors: those on it, and on the folders it holds. */
  const byMachine = useMemo(() => {
    const owner = new Map<string, string>();
    for (const device of devices) {
      owner.set(
        device.key,
        device.kind === 'machine' ? device.key : (device.parentKey ?? device.key)
      );
    }
    const map = new Map<string, Monitor[]>();
    for (const monitor of monitors) {
      if (!monitor.deviceKey) continue;
      const key = owner.get(monitor.deviceKey) ?? monitor.deviceKey;
      map.set(key, [...(map.get(key) ?? []), monitor]);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [devices, monitors]);

  // Website checks run on the server; a monitor on a machine no longer in
  // the inventory would otherwise show nowhere.
  const otherMonitors = useMemo(() => {
    const onMachines = new Set(
      machines.flatMap(machine => byMachine.get(machine.key) ?? [])
    );
    return monitors
      .filter(monitor => !onMachines.has(monitor))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [machines, byMachine, monitors]);

  const shown = useMemo(
    () =>
      machines.filter(machine => {
        if (filter === 'all') return true;
        const state = deviceState(machine, now);
        return filter === 'attention' ? state !== 'online' : state === filter;
      }),
    [machines, filter, now]
  );

  const checkAll = useCallback(() => {
    fleet
      .checkAll()
      .then(({ queued, skipped }) => {
        notify.success({
          title:
            queued.length > 0
              ? `Checking ${queued.length} ${queued.length === 1 ? 'machine' : 'machines'}`
              : 'No machine could be checked',
          message:
            skipped.length > 0
              ? `Skipped ${skipped.map(s => `${s.key} (${s.reason})`).join(', ')}`
              : undefined,
        });
      })
      .catch(err => {
        notify.error({ title: "Couldn't start the checks", message: errorMessage(err) });
      });
  }, [fleet]);

  const openMonitor = useCallback(
    (monitor: Monitor) => {
      workbench.openDoc(
        { docId: monitor.docId, mode: 'page', blockIds: [monitor.blockId] },
        { at: 'active' }
      );
    },
    [workbench]
  );

  if (!loaded) {
    return <div className={styles.empty}>Loading machines…</div>;
  }

  const tiles: { id: Filter; label: string; value: number; state?: DeviceState }[] = [
    { id: 'all', label: 'Machines', value: machines.length },
    { id: 'online', label: 'Online', value: summary.online, state: 'online' },
    { id: 'degraded', label: 'Degraded', value: summary.degraded, state: 'degraded' },
    { id: 'offline', label: 'Offline', value: summary.offline, state: 'offline' },
    { id: 'unknown', label: 'Not checked', value: summary.unknown, state: 'unknown' },
  ];

  return (
    <div className={styles.content} data-testid="monitoring-view">
      {machines.length > 0 ? (
        <>
          <div className={styles.tiles} data-testid="monitoring-summary">
            {tiles.map(tile => (
              <button
                key={tile.id}
                className={styles.tile}
                data-active={filter === tile.id || undefined}
                onClick={() => setFilter(prev => (prev === tile.id ? 'all' : tile.id))}
                data-testid={`monitoring-tile-${tile.id}`}
              >
                <span className={styles.tileValue}>{tile.value}</span>
                <span className={styles.tileLabel}>
                  {tile.state ? (
                    <span className={styles.dot} data-state={tile.state} />
                  ) : null}
                  {tile.label}
                </span>
              </button>
            ))}
          </div>
          <div className={styles.toolbar}>
            <span className={styles.toolbarHint}>
              {attention > 0
                ? `${attention} ${attention === 1 ? 'machine needs' : 'machines need'} a look.`
                : 'Every machine passed its last check.'}{' '}
              A check reads load, disk and memory on the machine.
            </span>
            {attention > 0 && filter !== 'attention' ? (
              <Button variant="plain" onClick={() => setFilter('attention')}>
                Show those
              </Button>
            ) : null}
            <Button
              variant="primary"
              onClick={checkAll}
              data-testid="monitoring-check-all"
            >
              Check all machines
            </Button>
          </div>
        </>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionTitle}>
          Machines
          <span className={styles.sectionCount}>
            {filter === 'all' ? machines.length : `${shown.length} of ${machines.length}`}
          </span>
        </div>
        {machines.length === 0 ? (
          <div className={styles.empty}>
            {error
              ? `Machines aren't available here: ${error}`
              : 'No machines yet. Register one with the wf CLI (it records machines in this workspace’s inventory), and allow agent execution on it to check it from here.'}
          </div>
        ) : shown.length === 0 ? (
          <div className={styles.empty}>No machine matches.</div>
        ) : (
          <div className={styles.grid}>
            {shown.map(machine => (
              <MachineCard
                key={machine.key}
                device={machine}
                folders={devices.filter(d => d.parentKey === machine.key)}
                monitors={byMachine.get(machine.key) ?? []}
                checking={checking.has(machine.key)}
                now={now}
                onOpenMonitor={openMonitor}
              />
            ))}
          </div>
        )}
      </section>

      {otherMonitors.length > 0 ? (
        <section className={styles.section}>
          <div className={styles.sectionTitle}>
            Other monitors
            <span className={styles.sectionCount}>{otherMonitors.length}</span>
          </div>
          <div className={styles.card}>
            <div className={styles.checks}>
              {otherMonitors.map(monitor => (
                <MonitorRow
                  key={monitor.id}
                  monitor={monitor}
                  now={now}
                  onOpen={openMonitor}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
};

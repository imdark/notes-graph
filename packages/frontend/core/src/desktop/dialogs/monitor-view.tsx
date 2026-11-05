import { Button, Modal, notify, RadioGroup } from '@notesgraph/component';
import {
  AgentExecutorService,
  AgentRunLogsStore,
  forkTranscript,
  type Monitor,
  monitorChatMessages,
  type MonitorReading,
  MonitorsService,
  type RemoteJob,
  RemoteAgentRunnerService,
  RESEARCH_MODEL,
} from '@notesgraph/core/modules/agents';
import type { DialogComponentProps } from '@notesgraph/core/modules/dialogs';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import type { WORKSPACE_DIALOG_SCHEMA } from '@notesgraph/core/modules/dialogs/constant';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import { watches } from '../pages/workspace/agents/monitors-section';
import { AgentLogView } from '../pages/workspace/detail-page/tabs/agent-log-view';
import {
  formatDuration,
  relativeTime,
} from '../pages/workspace/detail-page/tabs/agent-run-row';
import { AgentSideChat } from '../pages/workspace/detail-page/tabs/agent-side-chat';
import * as runStyles from '../pages/workspace/detail-page/tabs/agents.css';
import { ReadingsChart, ReadingsTable } from './monitor-readings';
import * as styles from './monitor-view.css';

/** Loaded data with the two other states every view of it has. */
type Loadable<T> =
  | { state: 'loading' }
  | { state: 'error'; error: string }
  | { state: 'ready'; value: T };

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** A command check and an agent run on a device, so they leave transcripts. */
const runsOnDevice = (monitor: Monitor) =>
  monitor.kind === 'agent' || monitor.source === 'command';

/**
 * Its readings and device runs, fetched again whenever a new reading lands
 * (the list refreshes every minute, and lastRunAt moves with each run).
 */
const useMonitorData = (monitor: Monitor | undefined) => {
  const monitorsService = useService(MonitorsService);
  const [readings, setReadings] = useState<Loadable<MonitorReading[]>>({
    state: 'loading',
  });
  const [runs, setRuns] = useState<Loadable<RemoteJob[]>>({
    state: 'loading',
  });
  const id = monitor?.id;
  const lastRunAt = monitor?.lastRunAt;
  const pending = monitor?.pending;
  const onDevice = monitor ? runsOnDevice(monitor) : false;

  useEffect(() => {
    if (!id) return;
    let live = true;
    monitorsService
      .readings(id)
      .then(value => live && setReadings({ state: 'ready', value }))
      .catch(
        err => live && setReadings({ state: 'error', error: message(err) })
      );
    if (onDevice) {
      monitorsService
        .runs(id)
        .then(value => live && setRuns({ state: 'ready', value }))
        .catch(err => live && setRuns({ state: 'error', error: message(err) }));
    } else {
      setRuns({ state: 'ready', value: [] });
    }
    return () => {
      live = false;
    };
  }, [id, lastRunAt, pending, onDevice, monitorsService]);

  return { readings, runs };
};

const ChartTab = ({ readings }: { readings: Loadable<MonitorReading[]> }) => {
  if (readings.state === 'loading')
    return <p className={runStyles.empty}>Loading readings…</p>;
  if (readings.state === 'error')
    return (
      <p className={runStyles.error}>
        Couldn&apos;t load its readings: {readings.error}
      </p>
    );
  if (!readings.value.length)
    return (
      <p className={runStyles.empty} data-testid="monitor-view-no-readings">
        No readings yet. The first one lands after its next check.
      </p>
    );
  return (
    <div className={runStyles.logDialogBody}>
      <ReadingsChart readings={readings.value} />
      <ReadingsTable readings={readings.value} />
    </div>
  );
};

const jobStatus: Record<RemoteJob['status'], string> = {
  held: 'Held',
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  error: 'Failed',
  cancelled: 'Cancelled',
};

const runLabel = (job: RemoteJob) =>
  [
    jobStatus[job.status],
    job.startedAt
      ? new Date(job.startedAt * 1000).toLocaleString()
      : 'not started',
    job.startedAt && job.finishedAt
      ? formatDuration((job.finishedAt - job.startedAt) * 1000)
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

/** One run's transcript, followed while it is still going. */
const useJobLog = (jobId: string | null) => {
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceId = useService(WorkspaceService).workspace.id;
  const [log, setLog] = useState<{
    text: string;
    job: RemoteJob | null;
    loading: boolean;
    error: string | null;
  }>({ text: '', job: null, loading: true, error: null });

  useEffect(() => {
    if (!jobId) return;
    setLog({ text: '', job: null, loading: true, error: null });
    const controller = new AbortController();
    (async () => {
      for await (const { job, logDelta } of remoteRunner.watch(
        workspaceId,
        jobId,
        controller.signal,
        // Looking at a monitor's log must not stop its run.
        { cancelOnAbort: false }
      )) {
        setLog(prev => ({
          text: prev.text + logDelta,
          job,
          loading: false,
          error: null,
        }));
      }
    })().catch(err => {
      if (controller.signal.aborted) return;
      setLog(prev => ({ ...prev, loading: false, error: message(err) }));
    });
    return () => controller.abort();
  }, [jobId, remoteRunner, workspaceId]);

  return log;
};

const LogTab = ({
  monitor,
  runs,
}: {
  monitor: Monitor;
  runs: Loadable<RemoteJob[]>;
}) => {
  const [picked, setPicked] = useState<string | null>(null);
  const list = runs.state === 'ready' ? runs.value : [];
  const jobId = picked ?? list[0]?.id ?? null;
  const log = useJobLog(jobId);

  if (!runsOnDevice(monitor)) {
    return (
      <p className={runStyles.empty} data-testid="monitor-view-no-log">
        A web check runs on the server and keeps no transcript. What each check
        found, or why it failed, is in the readings on the Chart tab.
      </p>
    );
  }
  if (runs.state === 'loading')
    return <p className={runStyles.empty}>Loading its runs…</p>;
  if (runs.state === 'error')
    return (
      <p className={runStyles.error}>
        Couldn&apos;t load its runs: {runs.error}
      </p>
    );
  if (!list.length)
    return (
      <p className={runStyles.empty} data-testid="monitor-view-no-runs">
        It hasn&apos;t run on {monitor.deviceKey ?? 'its device'} yet.
      </p>
    );

  const job = log.job ?? list.find(j => j.id === jobId) ?? null;
  return (
    <div className={runStyles.logDialogBody} data-testid="monitor-view-log">
      <label className={runStyles.hint}>
        Run{' '}
        <select
          className={styles.runPicker}
          value={jobId ?? ''}
          onChange={e => setPicked(e.target.value)}
          data-testid="monitor-view-run-picker"
        >
          {list.map(j => (
            <option key={j.id} value={j.id}>
              {runLabel(j)}
            </option>
          ))}
        </select>
      </label>
      {job?.status === 'error' && job.error ? (
        <p className={runStyles.error}>{job.error}</p>
      ) : null}
      {log.error ? (
        <p className={runStyles.error}>
          Couldn&apos;t load the log: {log.error}
        </p>
      ) : null}
      <AgentLogView
        log={log.text}
        resetKey={jobId}
        placeholder={
          log.loading
            ? 'Loading…'
            : job && ['held', 'queued'].includes(job.status)
              ? 'Waiting for the device to pick this up…'
              : job?.status === 'running'
                ? 'Waiting for output…'
                : 'This run left no log.'
        }
      />
      {job?.result ? (
        <>
          <span className={runStyles.hint}>How it ended</span>
          <pre className={runStyles.runDetailInput}>{job.result}</pre>
        </>
      ) : null}
    </div>
  );
};

const conditionLabel = (monitor: Monitor) => {
  const { condition } = monitor;
  switch (condition.type) {
    case 'above':
    case 'below':
      return `Alerts when it goes ${condition.type} ${condition.value}`;
    case 'change':
      return 'Alerts when it changes';
    default:
      return 'Alerts on every reading';
  }
};

const alertsLabel = (monitor: Monitor) => {
  const ways = [
    monitor.alerts.inApp ? 'in the app' : null,
    monitor.alerts.push ? 'push' : null,
    monitor.alerts.email ? 'email' : null,
  ].filter(Boolean);
  return ways.length ? ways.join(', ') : 'Nowhere (it only updates the block)';
};

/** What it was set up with, and the controls to change or run it. */
const SetupTab = ({
  monitor,
  onEdit,
  onOpenBlock,
}: {
  monitor: Monitor;
  onEdit: () => void;
  onOpenBlock: () => void;
}) => {
  const monitorsService = useService(MonitorsService);
  const [busy, setBusy] = useState(false);
  const act = useCallback((run: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    run()
      .then(() => done && notify.success({ title: done }))
      .catch(err => notify.error({ title: 'Monitor', message: message(err) }))
      .finally(() => setBusy(false));
  }, []);
  const { spec } = monitor;
  const rows: [string, string | null | undefined][] = [
    ['Watches', watches(monitor)],
    ['URL', spec.url],
    ['Command', spec.command],
    [
      'Reads',
      spec.extract
        ? `${spec.extract.type}${spec.extract.pattern ? `: ${spec.extract.pattern}` : ''}`
        : null,
    ],
    ['Model', monitor.kind === 'agent' ? (spec.model ?? 'claude-code') : null],
    ['Skills', spec.skills?.length ? spec.skills.join(', ') : null],
    ['Condition', conditionLabel(monitor)],
    ['Alerts', alertsLabel(monitor)],
    [
      'Last reading',
      monitor.lastValue
        ? `${monitor.lastValue}${monitor.lastRunAt ? ` (${relativeTime(monitor.lastRunAt * 1000)})` : ''}`
        : 'None yet',
    ],
    ['Last error', monitor.lastError],
    [
      'Next check',
      monitor.enabled
        ? new Date(monitor.nextRunAt * 1000).toLocaleString()
        : 'Paused',
    ],
  ];
  return (
    <div className={runStyles.logDialogBody} data-testid="monitor-view-setup">
      <dl className={runStyles.runDetails}>
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <Fragment key={label}>
              <dt className={runStyles.runDetailLabel}>{label}</dt>
              <dd className={runStyles.runDetailValue}>{value}</dd>
            </Fragment>
          ))}
      </dl>
      {spec.instructions ? (
        <>
          <span className={runStyles.hint}>Its instructions</span>
          <pre className={runStyles.runDetailInput}>{spec.instructions}</pre>
        </>
      ) : null}
      <div className={styles.actions}>
        <Button
          disabled={busy || monitor.pending}
          onClick={() =>
            act(() => monitorsService.runNow(monitor.id), 'Checking now')
          }
          data-testid="monitor-view-run-now"
        >
          {monitor.pending ? 'Running…' : 'Run now'}
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            act(() =>
              monitorsService.update(monitor.id, { enabled: !monitor.enabled })
            )
          }
          data-testid="monitor-view-pause"
        >
          {monitor.enabled ? 'Pause' : 'Resume'}
        </Button>
        <Button onClick={onEdit} data-testid="monitor-view-edit">
          Edit setup
        </Button>
        <Button variant="plain" onClick={onOpenBlock}>
          Go to the block
        </Button>
      </div>
    </div>
  );
};

/**
 * Ask about its results. An agent monitor is asked as the agent that ran it,
 * on its device (as a run's Ask tab asks its agent); a check, or an agent
 * monitor that hasn't run yet, is asked of the server's model. Either way the
 * chat opens on its setup, readings and latest run, and is kept in this
 * browser so it can be gone on with.
 */
const AskTab = ({
  monitor,
  readings,
  runs,
}: {
  monitor: Monitor;
  readings: MonitorReading[];
  runs: RemoteJob[];
}) => {
  const remoteRunner = useService(RemoteAgentRunnerService);
  const executor = useService(AgentExecutorService);
  const logsStore = useService(AgentRunLogsStore);
  const workspaceId = useService(WorkspaceService).workspace.id;
  const [waiting, setWaiting] = useState<string | null>(null);

  // The latest run that got going: one still queued has nothing to tell.
  const latest = runs.find(j => !['held', 'queued'].includes(j.status)) ?? null;
  const askAgent =
    monitor.kind === 'agent' &&
    monitor.spec.model !== RESEARCH_MODEL &&
    !!latest;

  const opening = useCallback(async () => {
    const run = latest
      ? await remoteRunner.get(workspaceId, latest.id).catch(() => latest)
      : null;
    return monitorChatMessages(monitor, {
      readings,
      run,
      transcript: run?.log ? forkTranscript(run.log) : undefined,
    });
  }, [latest, monitor, readings, remoteRunner, workspaceId]);

  const openModel = useMemo(
    () =>
      askAgent && latest
        ? () => executor.forkOf(latest, setWaiting)
        : undefined,
    [askAgent, executor, latest]
  );

  const chatKey = `monitor-ask:${monitor.id}`;
  const record = useMemo(
    () => ({
      load: async () => (await logsStore.getChat(chatKey)) ?? null,
      asking: () => {},
      ended: (chat: Parameters<typeof logsStore.putChat>[1]) => {
        logsStore.putChat(chatKey, chat).catch(() => {
          // Only the kept copy is lost; the chat on screen stands.
        });
      },
    }),
    [chatKey, logsStore]
  );

  return (
    <AgentSideChat
      title="Ask about its results"
      hint={
        askAgent
          ? `Asked of the agent that runs this monitor, on ${monitor.deviceKey ?? 'its device'}, with its setup, readings and latest run. It can explain, not act: nothing changes in the note.`
          : 'Asked of the server’s model, with its setup, readings and latest run. It can explain, not act: nothing changes in the note.'
      }
      placeholder={
        monitor.lastError
          ? 'Why did the last check fail?'
          : 'How has it moved this week? What did the last run find?'
      }
      opening={opening}
      openModel={openModel}
      record={record}
      waiting={waiting}
      testId="monitor-view-ask"
    />
  );
};

const CHART_TAB = 'chart';
const LOG_TAB = 'log';
const SETUP_TAB = 'setup';
const ASK_TAB = 'ask';
const TABS = [
  { value: CHART_TAB, label: 'Chart' },
  { value: LOG_TAB, label: 'Log' },
  { value: SETUP_TAB, label: 'Setup' },
  { value: ASK_TAB, label: 'Ask' },
];

const stateLabel = (monitor: Monitor) =>
  !monitor.enabled
    ? 'Paused'
    : monitor.pending
      ? 'Running'
      : monitor.lastError
        ? 'Failing'
        : 'Watching';

/**
 * A monitor's own view, opened from the 📡 chip on its block: like a run's
 * view, with its readings charted over time, the logs of its runs, what it
 * was set up with, and a chat to ask about its results.
 */
export const MonitorViewDialog = ({
  close,
  monitorId,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['monitor-view']>) => {
  const monitorsService = useService(MonitorsService);
  const dialogService = useService(WorkspaceDialogService);
  const workbench = useService(WorkbenchService).workbench;
  const monitors = useLiveData(monitorsService.monitors$);
  const listError = useLiveData(monitorsService.error$);
  const monitor = monitors.find(m => m.id === monitorId);
  const [tab, setTab] = useState(CHART_TAB);
  const { readings, runs } = useMonitorData(monitor);

  useEffect(() => monitorsService.watch(), [monitorsService]);

  const edit = useCallback(() => {
    if (!monitor) return;
    close();
    dialogService.open('monitor-editor', {
      docId: monitor.docId,
      blockId: monitor.blockId,
      monitorId: monitor.id,
    });
  }, [close, dialogService, monitor]);
  const openBlock = useCallback(() => {
    if (!monitor) return;
    close();
    workbench.openDoc(
      { docId: monitor.docId, mode: 'page', blockIds: [monitor.blockId] },
      { at: 'active' }
    );
  }, [close, monitor, workbench]);

  return (
    <Modal
      open
      onOpenChange={open => !open && close()}
      width={720}
      contentOptions={{
        style: { overflowY: 'auto', overscrollBehavior: 'contain' },
      }}
      title={
        monitor ? `📡 ${monitor.name} · ${stateLabel(monitor)}` : 'Monitor'
      }
      description={
        monitor
          ? [
              watches(monitor),
              monitor.lastRunAt
                ? `last checked ${relativeTime(monitor.lastRunAt * 1000)}`
                : 'not checked yet',
            ].join(' · ')
          : undefined
      }
    >
      <div className={runStyles.logDialogBody} data-testid="monitor-view">
        {!monitor ? (
          <p className={listError ? runStyles.error : runStyles.empty}>
            {listError
              ? `Couldn't load the monitor: ${listError}`
              : monitors.length
                ? 'This monitor has been deleted.'
                : 'Loading…'}
          </p>
        ) : (
          <>
            <RadioGroup
              width="100%"
              value={tab}
              onChange={setTab}
              items={TABS}
              data-testid="monitor-view-tabs"
            />
            {tab === CHART_TAB ? (
              <ChartTab readings={readings} />
            ) : tab === LOG_TAB ? (
              <LogTab monitor={monitor} runs={runs} />
            ) : tab === SETUP_TAB ? (
              <SetupTab
                monitor={monitor}
                onEdit={edit}
                onOpenBlock={openBlock}
              />
            ) : readings.state === 'loading' || runs.state === 'loading' ? (
              <p className={runStyles.empty}>Loading…</p>
            ) : (
              <AskTab
                monitor={monitor}
                readings={readings.state === 'ready' ? readings.value : []}
                runs={runs.state === 'ready' ? runs.value : []}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

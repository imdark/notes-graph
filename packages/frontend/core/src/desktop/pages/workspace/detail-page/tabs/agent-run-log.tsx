import { Button, Modal, notify, RadioGroup } from '@notesgraph/component';
import {
  type AgentRun,
  AgentRunLogsStore,
  AgentRunSessionService,
  AgentRunsStore,
  openQuestions,
  RemoteAgentRunnerService,
  type RemoteQuestion,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { AgentLogView } from './agent-log-view';
import { AgentQuestionCard } from './agent-question';
import { formatDuration } from './agent-run-row';
import * as styles from './agents.css';

interface RunLogState {
  log: string;
  /** Set for a remote run once its device has started it in tmux. */
  tmuxSession: string | null;
  /** What a remote run is waiting for the reader to answer. */
  questions: RemoteQuestion[];
  /** Why there is no log to show, when there isn't. */
  note: string | null;
  loading: boolean;
}

const EMPTY: RunLogState = {
  log: '',
  tmuxSession: null,
  questions: [],
  note: null,
  loading: true,
};

/**
 * A run's transcript, from wherever it lives.
 *
 * - A remote run: the server, polled while it runs. Always the server, even
 *   for a run started in this tab, because only the server knows the tmux
 *   session to offer.
 * - An on-device run happening in this tab: the live session.
 * - An on-device run that has ended: this browser's IndexedDB.
 */
const useRunLog = (run: AgentRun | undefined): RunLogState => {
  const sessionService = useService(AgentRunSessionService);
  const logsStore = useService(AgentRunLogsStore);
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceService = useService(WorkspaceService);
  const sessions = useLiveData(sessionService.sessions$);

  const session = run
    ? sessions.find(({ runId }) => runId === run.id)
    : undefined;
  const live = run && !run.remoteJobId && session?.running ? session : null;
  const [state, setState] = useState<RunLogState>(EMPTY);

  // The transcript as last seen live. The executor saves it to IndexedDB as
  // the run ends, so the first read after that can beat the write.
  const lastLive = useRef<{ runId: string; log: string } | null>(null);
  if (live) lastLive.current = { runId: live.runId as string, log: live.log };
  const isLive = !!live;

  const runId = run?.id;
  const remoteJobId = run?.remoteJobId;
  const finished = run?.status !== 'running';

  useEffect(() => {
    if (!runId || isLive) return;
    setState(EMPTY);
    const controller = new AbortController();

    if (remoteJobId) {
      const workspaceId = workspaceService.workspace.id;
      (async () => {
        for await (const { job, logDelta } of remoteRunner.watch(
          workspaceId,
          remoteJobId,
          controller.signal,
          // Closing the log must not stop the run it shows.
          { cancelOnAbort: false }
        )) {
          setState(prev => ({
            log: prev.log + logDelta,
            tmuxSession: job.tmuxSession,
            questions: openQuestions(job),
            note:
              job.status === 'queued'
                ? 'Waiting for the device to pick this up…'
                : null,
            loading: false,
          }));
        }
      })().catch(err => {
        if (controller.signal.aborted) return;
        setState(prev => ({
          ...prev,
          note: `Couldn't load the log: ${err instanceof Error ? err.message : String(err)}`,
          loading: false,
        }));
      });
    } else {
      logsStore
        .get(runId)
        .then(text => {
          if (controller.signal.aborted) return;
          if (text === undefined && lastLive.current?.runId === runId) {
            text = lastLive.current.log;
          }
          setState({
            log: text ?? '',
            tmuxSession: null,
            questions: [],
            note:
              text !== undefined
                ? null
                : finished
                  ? 'This run happened on another device. An on-device run keeps its log only in the browser that ran it.'
                  : 'This run is going in another tab or on another device. Its log is only viewable there.',
            loading: false,
          });
        })
        .catch(() => {
          setState({
            ...EMPTY,
            note: "Couldn't read the log.",
            loading: false,
          });
        });
    }
    return () => controller.abort();
    // `finished` matters only for the local path: re-read once the run ends.
  }, [
    runId,
    remoteJobId,
    isLive,
    finished,
    logsStore,
    remoteRunner,
    workspaceService,
  ]);

  if (live) {
    return {
      log: live.log,
      tmuxSession: null,
      questions: [],
      note: null,
      loading: false,
    };
  }
  return state;
};

const statusLabel: Record<AgentRun['status'], string> = {
  running: 'Running',
  done: 'Done',
  cancelled: 'Cancelled',
  error: 'Failed',
};

const harnessLabel: Record<string, string> = {
  'on-device': 'On-device (in the browser)',
  cloud: 'Cloud (the server’s model)',
  remote: 'Remote device',
};

const targetLabel = (run: AgentRun) => {
  switch (run.targetKind) {
    case 'block':
      return run.blockId ? `Block ${run.blockId}` : 'A block';
    case 'selection': {
      const count = run.blockIds?.length;
      return count
        ? `${count} selected block${count === 1 ? '' : 's'}`
        : 'A selection';
    }
    case 'doc':
      return 'The whole note';
    default:
      return run.targetKind;
  }
};

const LOG_TAB = 'log';
const DETAILS_TAB = 'details';
const TABS = [
  { value: LOG_TAB, label: 'Log' },
  { value: DETAILS_TAB, label: 'Details' },
];

/**
 * What a run was set up with: the blocks it read, where it ran and on what.
 * Runs recorded before these were kept have only some of it.
 */
const RunDetails = ({ run }: { run: AgentRun }) => {
  // Older rows have no harness; a device job id still says it went remote.
  const harness = run.harness ?? (run.remoteJobId ? 'remote' : undefined);
  const rows: [string, string | undefined][] = [
    ['Input', targetLabel(run)],
    [
      'Machine',
      run.deviceKey ??
        (harness === 'on-device' || harness === 'cloud'
          ? 'This browser'
          : undefined),
    ],
    ['Harness', harness ? (harnessLabel[harness] ?? harness) : undefined],
    ['Model', run.model],
    ['Folder', run.folder ?? (harness === 'remote' ? undefined : 'None bound')],
    ['Started', new Date(run.startedAt).toLocaleString()],
    [
      'Duration',
      run.durationMs !== undefined ? formatDuration(run.durationMs) : undefined,
    ],
    ['Steps', run.steps !== undefined ? String(run.steps) : undefined],
    ['Device job', run.remoteJobId],
  ];
  return (
    <div className={styles.logDialogBody} data-testid="agent-run-details">
      <dl className={styles.runDetails}>
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className={styles.runDetailLabel}>{label}</dt>
            <dd className={styles.runDetailValue}>{value ?? 'Not recorded'}</dd>
          </Fragment>
        ))}
      </dl>
      {run.input ? (
        <>
          <span className={styles.hint}>What it was given to read</span>
          <pre className={styles.runDetailInput}>{run.input}</pre>
        </>
      ) : null}
    </div>
  );
};

export const AgentRunLogDialog = ({
  runId,
  onClose,
}: {
  runId: string | null;
  onClose: () => void;
}) => {
  const runsStore = useService(AgentRunsStore);
  const sessionService = useService(AgentRunSessionService);
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceService = useService(WorkspaceService);
  const sessions = useLiveData(sessionService.sessions$);
  const run = useLiveData(
    useMemo(
      () => (runId ? runsStore.watchRun(runId) : null),
      [runsStore, runId]
    )
  );
  const { log, tmuxSession, questions, note, loading } = useRunLog(
    run ?? undefined
  );

  // A run can be stopped from here when this tab is driving it, or when it
  // is a device job (the server cancels it for whoever asks). An on-device
  // run in another tab has nothing here to stop.
  const session = run
    ? sessions.find(({ runId }) => runId === run.id)
    : undefined;
  const ownsRun = !!session?.running;
  const canStop = run?.status === 'running' && (ownsRun || !!run.remoteJobId);
  const [stopping, setStopping] = useState(false);
  const stop = useCallback(() => {
    if (!run) return;
    if (session?.running) {
      sessionService.cancel(session.id);
      return;
    }
    if (!run.remoteJobId) return;
    setStopping(true);
    remoteRunner
      .cancel(workspaceService.workspace.id, run.remoteJobId)
      .then(() => notify.success({ title: 'Stopping the run' }))
      .catch(err =>
        notify.error({
          title: "Couldn't stop the run",
          message: err instanceof Error ? err.message : String(err),
        })
      )
      .finally(() => setStopping(false));
  }, [remoteRunner, run, session, sessionService, workspaceService]);

  // Each run opens on its log.
  const [tab, setTab] = useState(LOG_TAB);
  useEffect(() => setTab(LOG_TAB), [runId]);

  const attachCommand = tmuxSession ? `tmux attach -t ${tmuxSession}` : null;
  const copyAttach = useCallback(() => {
    if (!attachCommand) return;
    navigator.clipboard
      .writeText(attachCommand)
      .then(() => notify.success({ title: 'Copied' }))
      .catch(() => notify.error({ title: "Couldn't copy" }));
  }, [attachCommand]);

  const meta = run
    ? [
        run.deviceKey ? `on ${run.deviceKey}` : 'on this device',
        new Date(run.startedAt).toLocaleString(),
        run.durationMs !== undefined ? formatDuration(run.durationMs) : null,
        run.steps ? `${run.steps} step${run.steps === 1 ? '' : 's'}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <Modal
      open={!!runId}
      onOpenChange={open => !open && onClose()}
      width={720}
      title={run ? `${run.agentName} · ${statusLabel[run.status]}` : 'Run log'}
      description={meta}
    >
      <div className={styles.logDialogBody}>
        {run ? (
          <RadioGroup
            width="100%"
            value={tab}
            onChange={setTab}
            items={TABS}
            data-testid="agent-run-log-tabs"
          />
        ) : null}
        {run && tab === DETAILS_TAB ? (
          <RunDetails run={run} />
        ) : (
          <div className={styles.logDialogBody} data-testid="agent-run-log">
            {attachCommand && run?.status === 'running' ? (
              <div className={styles.attachRow}>
                <span className={styles.hint}>
                  Watch it live on {run.deviceKey}:
                </span>
                <code className={styles.attachCommand}>{attachCommand}</code>
                <Button onClick={copyAttach}>Copy</Button>
              </div>
            ) : null}

            {run?.remoteJobId
              ? questions.map(question => (
                  <AgentQuestionCard
                    key={question.id}
                    jobId={run.remoteJobId as string}
                    question={question}
                  />
                ))
              : null}

            {run?.status === 'error' && run.error ? (
              <p className={styles.error}>{run.error}</p>
            ) : null}

            {note ? <p className={styles.empty}>{note}</p> : null}

            <AgentLogView
              log={log}
              resetKey={runId}
              placeholder={
                loading
                  ? 'Loading…'
                  : run?.status === 'running'
                    ? 'Waiting for output…'
                    : note
                      ? ''
                      : 'This run left no log.'
              }
            />

            {canStop ? (
              <div className={styles.sessionActions}>
                <Button
                  variant="error"
                  disabled={stopping}
                  onClick={stop}
                  data-testid="agent-run-log-stop"
                >
                  Stop run
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Modal>
  );
};

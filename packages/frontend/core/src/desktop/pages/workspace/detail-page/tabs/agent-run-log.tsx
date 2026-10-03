import { Button, Modal, notify } from '@notesgraph/component';
import {
  type AgentRun,
  AgentRunLogsStore,
  AgentRunSessionService,
  AgentRunsStore,
  RemoteAgentRunnerService,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useLiveData, useService } from '@notesgraph/infra';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import * as styles from './agents.css';

interface RunLogState {
  log: string;
  /** Set for a remote run once its device has started it in tmux. */
  tmuxSession: string | null;
  /** Why there is no log to show, when there isn't. */
  note: string | null;
  loading: boolean;
}

const EMPTY: RunLogState = {
  log: '',
  tmuxSession: null,
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
  const session = useLiveData(sessionService.session$);

  const live =
    run && !run.remoteJobId && session?.runId === run.id && session.running
      ? session
      : null;
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
          setState({ ...EMPTY, note: "Couldn't read the log.", loading: false });
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
    return { log: live.log, tmuxSession: null, note: null, loading: false };
  }
  return state;
};

const statusLabel: Record<AgentRun['status'], string> = {
  running: 'Running',
  done: 'Done',
  cancelled: 'Cancelled',
  error: 'Failed',
};

const formatDuration = (ms: number) => {
  const secs = Math.round(ms / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
};

export const AgentRunLogDialog = ({
  runId,
  onClose,
}: {
  runId: string | null;
  onClose: () => void;
}) => {
  const runsStore = useService(AgentRunsStore);
  const run = useLiveData(
    useMemo(
      () => (runId ? runsStore.watchRun(runId) : null),
      [runsStore, runId]
    )
  );
  const { log, tmuxSession, note, loading } = useRunLog(run ?? undefined);

  // Follow the end of the log while the reader is at the end; once they
  // scroll up to read something, stop yanking them back down.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToEnd = useRef(true);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToEnd.current) el.scrollTop = el.scrollHeight;
  }, [log]);
  useEffect(() => {
    stickToEnd.current = true;
  }, [runId]);

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
      <div className={styles.logDialogBody} data-testid="agent-run-log">
        {attachCommand && run?.status === 'running' ? (
          <div className={styles.attachRow}>
            <span className={styles.hint}>Watch it live on {run.deviceKey}:</span>
            <code className={styles.attachCommand}>{attachCommand}</code>
            <Button onClick={copyAttach}>
              Copy
            </Button>
          </div>
        ) : null}

        {run?.status === 'error' && run.error ? (
          <p className={styles.error}>{run.error}</p>
        ) : null}

        {note ? <p className={styles.empty}>{note}</p> : null}

        <div ref={scrollRef} onScroll={onScroll} className={styles.logScroll}>
          <pre className={styles.logText} data-testid="agent-run-log-text">
            {log ||
              (loading
                ? 'Loading…'
                : run?.status === 'running'
                  ? 'Waiting for output…'
                  : note
                    ? ''
                    : 'This run left no log.')}
          </pre>
        </div>
      </div>
    </Modal>
  );
};

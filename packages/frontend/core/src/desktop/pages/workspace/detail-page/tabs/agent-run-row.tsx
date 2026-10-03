import type { AgentRun } from '@notesgraph/core/modules/agents';
import { DocDisplayMetaService } from '@notesgraph/core/modules/doc-display-meta';
import { useLiveData, useService } from '@notesgraph/infra';
import { useEffect, useMemo, useState } from 'react';

import * as styles from './agents.css';

export const relativeTime = (at: number, now = Date.now()) => {
  const secs = Math.round((now - at) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

export const formatDuration = (ms: number) => {
  const secs = Math.round(ms / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
};

/** Re-render every minute so "5m ago" doesn't stay "just now" forever. */
export const useMinuteTick = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
};

/** A run's status as a reader thinks of it; `waiting` is a running run with a question open. */
export type RunDisplayStatus = AgentRun['status'] | 'waiting';

const statusLabel: Record<RunDisplayStatus, string> = {
  running: 'Running',
  waiting: 'Needs you',
  done: 'Done',
  cancelled: 'Cancelled',
  error: 'Failed',
};

export const RunStatusBadge = ({ status }: { status: RunDisplayStatus }) => (
  <span
    className={styles.statusBadge}
    data-status={status}
    data-testid="agent-run-status"
  >
    {status === 'running' ? <span className={styles.statusPulse} /> : null}
    {statusLabel[status]}
  </span>
);

export const runOutcomeText = (run: AgentRun) =>
  run.status === 'error'
    ? (run.error ?? 'Failed without a message.')
    : run.status === 'cancelled'
      ? 'Stopped before it finished.'
      : run.status === 'running'
        ? 'Working…'
        : run.summary || 'Finished with no answer.';

const DocLink = ({
  docId,
  onOpenDoc,
}: {
  docId: string;
  onOpenDoc: (docId: string) => void;
}) => {
  const displayMeta = useService(DocDisplayMetaService);
  const title = useLiveData(
    useMemo(() => displayMeta.title$(docId), [displayMeta, docId])
  );
  return (
    <span
      role="link"
      tabIndex={0}
      className={styles.runDoc}
      title={`Open ${title}`}
      onClick={e => {
        e.stopPropagation();
        onOpenDoc(docId);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.stopPropagation();
          onOpenDoc(docId);
        }
      }}
    >
      {title}
    </span>
  );
};

/**
 * One run in a list. Clicking it opens the log; with `onOpenDoc`, the note it
 * ran on is shown too and opens on its own click.
 */
export const RunRow = ({
  run,
  status = run.status,
  now,
  onOpen,
  onOpenDoc,
}: {
  run: AgentRun;
  status?: RunDisplayStatus;
  now: number;
  onOpen: (runId: string) => void;
  onOpenDoc?: (docId: string) => void;
}) => (
  <button
    className={styles.runRowButton}
    onClick={() => onOpen(run.id)}
    title="View log"
    data-testid="agent-run-row"
  >
    <div className={styles.runText}>
      <span className={styles.runHead}>
        <span className={styles.runName}>{run.agentName}</span>
        {onOpenDoc && run.docId ? (
          <>
            <span className={styles.runWhen}>on</span>
            <DocLink docId={run.docId} onOpenDoc={onOpenDoc} />
          </>
        ) : null}
      </span>
      <span className={styles.runMeta} data-status={run.status}>
        {runOutcomeText(run)}
      </span>
    </div>
    <div className={styles.runSide}>
      <RunStatusBadge status={status} />
      <span className={styles.runWhen}>
        {relativeTime(run.startedAt, now)}
        {run.durationMs !== undefined
          ? ` · ${formatDuration(run.durationMs)}`
          : ''}
      </span>
    </div>
  </button>
);

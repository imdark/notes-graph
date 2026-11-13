import type {
  MergeReadiness,
  ReleaseState,
  ReleaseTask,
} from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useService } from '@notesgraph/infra';
import { useCallback } from 'react';

import * as styles from './styles.css';

/** A pull request's readiness to merge, as a badge. */
export const READINESS: Record<
  MergeReadiness,
  { label: string; tone: 'good' | 'bad' | 'neutral' }
> = {
  ready: { label: 'Ready', tone: 'good' },
  unknown: { label: 'Mergeable?', tone: 'neutral' },
  conflicts: { label: 'Conflicts', tone: 'bad' },
  failing: { label: 'Checks failing', tone: 'bad' },
  pending: { label: 'Checks running', tone: 'neutral' },
  draft: { label: 'Draft', tone: 'neutral' },
};

export const badgeClass = (tone: 'good' | 'bad' | 'neutral') =>
  tone === 'good'
    ? styles.badgeGood
    : tone === 'bad'
      ? styles.badgeBad
      : styles.badge;

export const pillClass = (tone: 'good' | 'bad' | 'busy' | 'neutral') =>
  tone === 'good'
    ? styles.pillGood
    : tone === 'bad'
      ? styles.pillBad
      : tone === 'busy'
        ? styles.pillBusy
        : styles.pill;

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** "12 Nov 07:04" */
export const when = (iso: string | null | undefined) => {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** "2h", "3d", "just now" */
export const ago = (iso: string | null | undefined) => {
  if (!iso) return '';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

/** A pull request's URL in the repo the screen releases. */
export const pullUrl = (state: ReleaseState, number: number) =>
  state.settings
    ? `https://github.com/${state.settings.repo}/pull/${number}`
    : null;

/** Open a task block in its note, as the legacy view's rows do. */
export const useOpenTask = () => {
  const workbench = useService(WorkbenchService).workbench;
  return useCallback(
    (task: Pick<ReleaseTask, 'docId' | 'blockId'>) => {
      workbench.openDoc(
        {
          docId: task.docId,
          mode: 'page',
          blockIds: [task.blockId],
          refreshKey: 'deploy-' + Date.now(),
        },
        { at: 'active' }
      );
    },
    [workbench]
  );
};

/** "↳ task title" links to the tasks a pull request is linked to. */
export const TaskLinks = ({ tasks }: { tasks: ReleaseTask[] | undefined }) => {
  const openTask = useOpenTask();
  if (!tasks?.length) return null;
  return (
    <>
      {tasks.map(task => (
        <button
          key={`${task.docId}:${task.blockId}`}
          className={styles.link}
          onClick={() => openTask(task)}
          data-testid="release-task-link"
        >
          ↳ {task.title || 'Untitled task'}
        </button>
      ))}
    </>
  );
};

import { Button } from '@notesgraph/component';
import type {
  ReleaseJob,
  ReleaseJobStatus,
} from '@notesgraph/core/modules/agents';

import { pillClass } from './shared';
import * as styles from './styles.css';

const STATUS: Record<
  ReleaseJobStatus,
  { label: string; tone: 'busy' | 'neutral' }
> = {
  running: { label: 'Running', tone: 'busy' },
  queued: { label: 'Queued', tone: 'neutral' },
  waiting: { label: 'Waits for the deploy to end', tone: 'neutral' },
};

/**
 * The screen's merges, releases and the like still to run, in order, the
 * one under way first. Each that hasn't started can be taken off.
 */
export const ActionQueue = ({
  jobs,
  onCancel,
}: {
  jobs: ReleaseJob[];
  onCancel: (id: number) => void;
}) => {
  if (jobs.length === 0) return null;
  return (
    <section className={styles.section} data-testid="release-queue">
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>
          Queue
          <span className={styles.sectionCount}>{jobs.length}</span>
        </div>
      </div>
      <div className={styles.sectionHint}>
        One runs at a time, in the order asked. A release waits for a running
        deploy, and takes what is on the base branch when its turn comes.
      </div>
      <div className={styles.rows}>
        {jobs.map(job => {
          const status = STATUS[job.status];
          return (
            <div
              key={job.id}
              className={styles.row}
              data-testid="release-queue-row"
            >
              <div className={styles.rowBody}>
                <span className={styles.rowTitle}>{job.label}</span>
                <span className={styles.rowMeta}>
                  <span
                    className={pillClass(status.tone)}
                    data-testid="release-queue-status"
                  >
                    {status.label}
                  </span>
                </span>
              </div>
              {job.status === 'running' ? null : (
                <div className={styles.rowActions}>
                  <Button
                    variant="plain"
                    onClick={() => onCancel(job.id)}
                    data-testid="release-queue-cancel"
                  >
                    Remove
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

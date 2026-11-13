import { Button } from '@notesgraph/component';
import {
  releaseAction,
  type ReleaseState,
} from '@notesgraph/core/modules/agents';

import { ago, TaskLinks } from './shared';
import * as styles from './styles.css';

/**
 * What the next release takes out: pull requests merged into the base
 * branch since the deploy branch was last moved to it.
 */
export const NextRelease = ({
  state,
  busy,
  onRelease,
}: {
  state: ReleaseState;
  busy: boolean;
  onRelease: () => void;
}) => {
  const base = state.settings?.baseBranch ?? 'stage';
  const deploy = state.settings?.deployBranch ?? 'main';
  const { prs, commits } = state.next;
  const release = releaseAction(state);
  return (
    <section className={styles.section} data-testid="release-next">
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>
          Next release · on {base}, not on {deploy}
          <span className={styles.sectionCount}>{prs.length}</span>
        </div>
        <Button
          variant="primary"
          disabled={busy || release.disabled}
          tooltip={release.reason ?? undefined}
          onClick={onRelease}
          data-testid="release-next-release"
        >
          Release
        </Button>
      </div>
      {prs.length === 0 ? (
        <div className={styles.empty}>
          {commits > 0
            ? `${commits} commit${commits === 1 ? '' : 's'} on ${base} that ${deploy} lacks, none from a merged pull request.`
            : `Nothing on ${base} that ${deploy} lacks.`}
        </div>
      ) : (
        <div className={styles.rows}>
          {prs.map(pr => (
            <div key={pr.number} className={styles.row}>
              <div className={styles.rowBody}>
                <span className={styles.rowTitle}>
                  <a
                    className={styles.link}
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    #{pr.number}
                  </a>{' '}
                  {pr.title}
                </span>
                <span className={styles.rowMeta}>
                  <span>
                    {pr.author}
                    {pr.mergedAt ? ` · ${ago(pr.mergedAt)}` : ''}
                  </span>
                  <TaskLinks tasks={state.tasks[pr.number]} />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

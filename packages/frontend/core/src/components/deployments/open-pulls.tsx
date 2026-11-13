import { Button } from '@notesgraph/component';
import {
  type Agent,
  canFixToMerge,
  mergesDirectly,
  readyPulls,
  type ReleasePull,
  type ReleaseState,
} from '@notesgraph/core/modules/agents';

import { badgeClass, READINESS, TaskLinks } from './shared';
import * as styles from './styles.css';

/** Says where to add the agent "Fix with Claude" needs. */
export const NO_FIX_AGENT =
  'Fixing needs a Claude Code agent on a device with this repo: add one in Settings → Agents.';

/**
 * Pull requests open into the base branch, each with whether it merges, and
 * Merge or Fix with Claude.
 */
export const OpenPulls = ({
  state,
  busy,
  agent,
  onMerge,
  onMergeAll,
  onFix,
}: {
  state: ReleaseState;
  busy: boolean;
  /** The device agent Fix with Claude goes to; none disables it. */
  agent: Agent | undefined;
  onMerge: (pr: ReleasePull) => void;
  onMergeAll: (prs: ReleasePull[]) => void;
  onFix: (pr: ReleasePull) => void;
}) => {
  const base = state.settings?.baseBranch ?? 'stage';
  const ready = readyPulls(state.open);
  return (
    <section className={styles.section} data-testid="release-open">
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitle}>
          Open pull requests
          <span className={styles.sectionCount}>{state.open.length}</span>
        </div>
        <Button
          disabled={busy || ready.length === 0}
          tooltip={
            ready.length === 0
              ? 'None is ready: drafts, conflicts and failing checks are left'
              : undefined
          }
          onClick={() => onMergeAll(ready)}
          data-testid="release-merge-all"
        >
          Merge all ready{ready.length > 0 ? ` (${ready.length})` : ''}
        </Button>
      </div>
      {state.open.length === 0 ? (
        <div className={styles.empty}>No pull request is open into {base}.</div>
      ) : (
        <div className={styles.rows}>
          {state.open.map(pr => {
            const { label, tone } = READINESS[pr.readiness];
            return (
              <div
                key={pr.number}
                className={styles.row}
                data-testid="release-open-row"
              >
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
                    <span className={badgeClass(tone)}>{label}</span>
                    <span>{pr.branch}</span>
                    <span>{pr.author}</span>
                    <TaskLinks tasks={state.tasks[pr.number]} />
                  </span>
                </div>
                <div className={styles.rowActions}>
                  {mergesDirectly(pr.readiness) ? (
                    <Button
                      disabled={busy}
                      onClick={() => onMerge(pr)}
                      data-testid="release-merge"
                    >
                      Merge
                    </Button>
                  ) : null}
                  {canFixToMerge(pr.readiness) ? (
                    <Button
                      disabled={busy || !agent}
                      tooltip={
                        agent
                          ? `${agent.name} on ${agent.deviceKey} fixes it and merges it`
                          : NO_FIX_AGENT
                      }
                      onClick={() => onFix(pr)}
                      data-testid="release-fix"
                    >
                      Fix with Claude
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!agent && state.open.some(pr => canFixToMerge(pr.readiness)) ? (
        <div className={styles.sectionHint}>{NO_FIX_AGENT}</div>
      ) : null}
    </section>
  );
};

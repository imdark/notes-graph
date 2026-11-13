import { Button, Menu, MenuItem } from '@notesgraph/component';
import {
  flagStage,
  formatDuration,
  productionPill,
  productionTimes,
  releaseAction,
  type ReleaseState,
  rollbackTargets,
  sha7,
} from '@notesgraph/core/modules/agents';
import { NOTESGRAPH_FLAGS } from '@notesgraph/core/modules/feature-flag';

import { pillClass, when } from './shared';
import * as styles from './styles.css';

/**
 * The app's feature flags checked against prod's build by the commit that
 * added each (the legacy view's FlagsLine).
 */
const FlagsLine = ({
  state,
  onOpenFlags,
}: {
  state: ReleaseState;
  onOpenFlags: () => void;
}) => {
  const deploy = state.production.deployInfo;
  if (!deploy?.featureFlags) return null;
  const missing = Object.entries(NOTESGRAPH_FLAGS).filter(
    ([key, flag]) => flagStage(key, flag.commit, deploy) === 'not-deployed'
  );
  return (
    <div className={styles.cardLine} data-testid="release-flags">
      <span>
        Flags not in prod:{' '}
        {missing.length === 0 ? 'none' : missing.map(([key]) => key).join(', ')}
      </span>
      <button className={styles.link} onClick={onOpenFlags}>
        Feature flags
      </button>
    </div>
  );
};

/**
 * What prod runs now: its commit and the run that put it there, what a
 * running deploy is doing, and the page's primary actions.
 */
export const ProductionCard = ({
  state,
  busy,
  onRelease,
  onRedeploy,
  onRollback,
  onRetry,
  onOpenFlags,
}: {
  state: ReleaseState;
  /** An action of the screen's is under way. */
  busy: boolean;
  onRelease: () => void;
  onRedeploy: () => void;
  onRollback: (imageSha: string) => void;
  onRetry: (runId: number) => void;
  onOpenFlags: () => void;
}) => {
  const { production } = state;
  const { deployInfo, status, steps } = production;
  // With no record, the latest run says what was last deployed.
  const run = production.run ?? state.history[0] ?? null;
  const pill = productionPill(state);
  const deploying = status === 'deploying';
  const release = releaseAction(state);
  const targets = rollbackTargets(state);
  const commit =
    status === 'rolled-back'
      ? (run?.rollbackTo ?? deployInfo?.commit)
      : (deployInfo?.commit ?? run?.sha);
  const times = productionTimes(state);
  const liveRun = times.live.run ?? (deploying ? null : run);
  const off = busy || deploying;

  return (
    <section className={styles.card} data-testid="release-production">
      <div className={styles.sectionTitle}>Production</div>
      <div className={styles.cardLine}>
        <span className={pillClass(pill.tone)} data-testid="release-pill">
          {pill.label}
        </span>
        {commit ? <code className={styles.sha}>{sha7(commit)}</code> : null}
        {deployInfo?.subject ? (
          <span className={styles.cardSubject}>{deployInfo.subject}</span>
        ) : null}
      </div>
      {deployInfo ? null : (
        <div className={styles.sectionHint} data-testid="release-no-record">
          This build has no deploy record; it starts with the next deploy.
          {run ? ' Latest run below.' : ''}
        </div>
      )}
      <div className={styles.cardLine}>
        {times.live.at ? (
          <span>
            {deploying ? 'live since' : 'deployed'} {when(times.live.at)}
          </span>
        ) : null}
        {deployInfo?.dirty ? <span>with uncommitted changes</span> : null}
        {liveRun ? (
          <a
            className={styles.link}
            href={liveRun.url}
            target="_blank"
            rel="noreferrer"
          >
            run {liveRun.id}
          </a>
        ) : null}
        {liveRun?.durationMs ? (
          <span>{formatDuration(liveRun.durationMs)}</span>
        ) : null}
      </div>
      {times.deploying ? (
        <div className={styles.cardLine} data-testid="release-deploying">
          <span>
            Deploying{' '}
            <code className={styles.sha}>{sha7(times.deploying.sha)}</code>,
            started {when(times.deploying.startedAt)} (
            {formatDuration(
              Date.now() - Date.parse(times.deploying.startedAt)
            ) || 'just now'}{' '}
            so far)
          </span>
          <a
            className={styles.link}
            href={times.deploying.run.url}
            target="_blank"
            rel="noreferrer"
          >
            run {times.deploying.run.id}
          </a>
        </div>
      ) : null}
      {deploying && steps.length > 0 ? (
        <div className={styles.steps} data-testid="release-steps">
          {steps.map((step, i) => (
            <span key={step.name} className={styles.steps}>
              {i > 0 ? <span className={styles.step}>→</span> : null}
              <span className={styles.step} data-status={step.status}>
                {step.name}
              </span>
            </span>
          ))}
        </div>
      ) : null}
      {status === 'failed' && run ? (
        <div className={styles.cardLine}>
          <span className={styles.runError}>The last deploy failed.</span>
          <Button
            size="default"
            disabled={busy}
            onClick={() => onRetry(run.id)}
            data-testid="release-retry"
          >
            Retry
          </Button>
          <a
            className={styles.link}
            href={run.url}
            target="_blank"
            rel="noreferrer"
          >
            Open log
          </a>
        </div>
      ) : null}
      <FlagsLine state={state} onOpenFlags={onOpenFlags} />
      <div className={styles.cardActions}>
        {deploying && run ? (
          <a
            className={styles.link}
            href={run.url}
            target="_blank"
            rel="noreferrer"
            // The actions row sets no size of its own, so `font: inherit`
            // took the page's 16px default; match the buttons beside it.
            style={{ alignSelf: 'center', fontSize: 12 }}
          >
            Open run
          </a>
        ) : null}
        <Button
          variant="primary"
          disabled={busy || release.disabled}
          tooltip={release.reason ?? undefined}
          onClick={onRelease}
          data-testid="release-release"
        >
          {release.label}
        </Button>
        <Button
          disabled={off || !state.settings}
          tooltip={`Deploys ${state.settings?.deployBranch ?? 'main'} again as it is`}
          onClick={onRedeploy}
          data-testid="release-redeploy"
        >
          Redeploy
        </Button>
        <Menu
          items={
            targets.length > 0 ? (
              targets.map(({ imageSha, run: target }) => (
                <MenuItem
                  key={imageSha}
                  onClick={() => onRollback(imageSha)}
                  data-testid="release-rollback-item"
                >
                  {sha7(imageSha)} · {when(target.startedAt)}
                </MenuItem>
              ))
            ) : (
              <MenuItem disabled>No earlier release to go back to</MenuItem>
            )
          }
        >
          <Button disabled={off} data-testid="release-rollback">
            Roll back ▾
          </Button>
        </Menu>
      </div>
      {release.disabled && release.reason && !deploying ? (
        <div className={styles.sectionHint} data-testid="release-why-off">
          {release.reason}
        </div>
      ) : null}
    </section>
  );
};

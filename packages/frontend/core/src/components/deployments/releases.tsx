import { Button, notify, useConfirmModal } from '@notesgraph/component';
import {
  AgentsService,
  apkConfirmText,
  defaultReleaseSettings,
  DeploymentsService,
  mergeConfirmText,
  queueAhead,
  queuedPulls,
  releaseBlocker,
  releaseConfirmText,
  type ReleaseJobSpec,
  type ReleasePull,
  type ReleaseState,
  rollbackConfirmText,
  sha7,
  shipAgents,
  tokenMissingText,
} from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { ActionQueue } from './action-queue';
import { AndroidCard } from './android-card';
import { NextRelease } from './next-release';
import { OpenPulls } from './open-pulls';
import { ProductionCard } from './production-card';
import { ReleaseHistory } from './release-history';
import { RepoSettingsDialog } from './repo-settings-dialog';
import { ago, errorMessage } from './shared';
import * as styles from './styles.css';

const isMobile = BUILD_CONFIG.isMobileEdition;

/** "just now", "5m ago" */
const readAgo = (iso: string) => {
  const age = ago(iso);
  return !age || age === 'just now' ? 'just now' : `${age} ago`;
};

/** A confirm's description: what it does, then the pull requests it takes. */
const listed = (text: string, prs: Pick<ReleasePull, 'number' | 'title'>[]) => (
  <>
    {text}
    {prs.length > 0 ? (
      <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        {prs.map(pr => (
          <li key={pr.number}>
            #{pr.number} {pr.title}
          </li>
        ))}
      </ul>
    ) : null}
  </>
);

/**
 * The release-centric Deployments page (enable_release_screen): what prod
 * runs, the next release, open pull requests and past deploys, all read by
 * the server from GitHub (plugins/registry/releases) and polled while the
 * page is open. Shared by the desktop page and the phone's.
 */
export const ReleasesView = () => {
  const deployments = useService(DeploymentsService);
  const workbench = useService(WorkbenchService).workbench;
  const { openConfirmModal } = useConfirmModal();
  const state = useLiveData(deployments.release$);
  const error = useLiveData(deployments.releaseError$);
  const deployInfo = useLiveData(deployments.deployInfo$);
  const agents = useLiveData(useService(AgentsService).agents$);
  const agent = useMemo(() => shipAgents(agents)[0], [agents]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const queue = deployments.releaseQueue;
  const jobs = useLiveData(queue.jobs$);
  const ahead = useMemo(() => queueAhead(jobs), [jobs]);
  const pulls = useMemo(() => queuedPulls(jobs), [jobs]);
  const queued = useCallback(
    (key: string) => jobs.some(job => job.key === key),
    [jobs]
  );

  useEffect(() => deployments.pollRelease(), [deployments]);
  // Prefills the set-up dialog's repo when the server has no state to say.
  useEffect(() => {
    deployments.refreshDeployInfo().catch(() => {});
  }, [deployments]);

  const openSecrets = isMobile ? null : () => workbench.open('/secrets');
  const refresh = useCallback(() => {
    setRefreshing(true);
    deployments
      .refreshRelease({ fresh: true })
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [deployments]);

  /**
   * Queue one of the screen's actions; it says how it went when it has run.
   * The page's buttons stay on meanwhile, so more can be queued.
   */
  const act = useCallback(
    (
      spec: Omit<ReleaseJobSpec, 'run'> & { failTitle: string },
      fn: () => Promise<void>
    ) => {
      queue.add({
        ...spec,
        run: async () => {
          try {
            await fn();
          } catch (err) {
            notify.error({ title: spec.failTitle, message: errorMessage(err) });
          }
        },
      });
    },
    [queue]
  );

  const confirm = useCallback(
    (opts: {
      title: string;
      description: ReactNode;
      confirmText: string;
      onConfirm: () => void;
    }) =>
      openConfirmModal({
        title: opts.title,
        description: opts.description,
        confirmText: opts.confirmText,
        confirmButtonOptions: { variant: 'error' },
        onConfirm: opts.onConfirm,
      }),
    [openConfirmModal]
  );

  const release = useCallback(
    (current: ReleaseState) => {
      const base = current.settings?.baseBranch ?? 'stage';
      const deploy = current.settings?.deployBranch ?? 'main';
      const waits = current.production.status === 'deploying' || ahead.jobs > 0;
      const count = current.next.prs.length;
      confirm({
        title: waits
          ? `Queue a release of ${base}?`
          : `Release ${count} PR${count === 1 ? '' : 's'}?`,
        description: listed(
          releaseConfirmText(current, ahead),
          current.next.prs
        ),
        confirmText: waits ? 'Queue release' : 'Release',
        onConfirm: () =>
          act(
            {
              kind: 'release',
              label: `Release ${base} to ${deploy}`,
              afterDeploy: true,
              failTitle: "Couldn't release",
            },
            async () => {
              const result = await deployments.releaseNext();
              if (!result) {
                notify({
                  title: 'Nothing new to release',
                  message: `${deploy} already has everything on ${base}.`,
                });
                return;
              }
              notify.success({
                title: `Releasing ${sha7(result.sha)}`,
                message: result.run
                  ? `Deploy run ${result.run.id} started.`
                  : 'The deploy was started; its run shows here once GitHub lists it.',
              });
            }
          ),
      });
    },
    [act, ahead, confirm, deployments]
  );

  const redeploy = useCallback(
    (current: ReleaseState) => {
      const deploy = current.settings?.deployBranch ?? 'main';
      confirm({
        title: `Redeploy ${deploy}?`,
        description: `Builds and deploys ${deploy} (${sha7(current.production.mainSha)}) again with ${current.settings?.workflowFile ?? 'the deploy workflow'}.`,
        confirmText: 'Redeploy',
        onConfirm: () =>
          act(
            {
              kind: 'redeploy',
              key: 'redeploy',
              label: `Redeploy ${deploy}`,
              afterDeploy: true,
              failTitle: "Couldn't redeploy",
            },
            async () => {
              await deployments.redeploy();
              notify.success({ title: `Redeploying ${deploy}` });
            }
          ),
      });
    },
    [act, confirm, deployments]
  );

  const rollback = useCallback(
    (imageSha: string) =>
      confirm({
        title: `Roll back to ${sha7(imageSha)}?`,
        description: rollbackConfirmText(imageSha),
        confirmText: 'Roll back',
        onConfirm: () =>
          act(
            {
              kind: 'rollback',
              key: 'rollback',
              label: `Roll back to ${sha7(imageSha)}`,
              afterDeploy: true,
              failTitle: "Couldn't roll back",
            },
            async () => {
              await deployments.rollback(imageSha);
              notify.success({ title: `Rolling back to ${sha7(imageSha)}` });
            }
          ),
      }),
    [act, confirm, deployments]
  );

  const retry = useCallback(
    (runId: number) =>
      act(
        {
          kind: 'retry',
          key: `retry:${runId}`,
          label: `Retry run ${runId}`,
          afterDeploy: true,
          failTitle: "Couldn't retry the deploy",
        },
        async () => {
          await deployments.retry(runId);
          notify.success({ title: `Retrying run ${runId}` });
        }
      ),
    [act, deployments]
  );

  const buildApk = useCallback(
    (ref: string, force: boolean) =>
      confirm({
        title: force
          ? `Build the APK from ${ref}?`
          : `Build the APK from ${ref} if it changed?`,
        description: apkConfirmText(ref, force),
        confirmText: 'Build APK',
        onConfirm: () =>
          act(
            {
              kind: 'apk',
              key: 'apk',
              label: `Build the APK from ${ref}`,
              failTitle: "Couldn't start the APK build",
            },
            async () => {
              const { run } = await deployments.buildApk(ref, force);
              notify.success({
                title: `Building the APK from ${ref}`,
                message: run
                  ? `Run ${run.id} started.`
                  : 'The build was started; its run shows here once GitHub lists it.',
              });
            }
          ),
      }),
    [act, confirm, deployments]
  );

  const merge = useCallback(
    (current: ReleaseState, pr: ReleasePull) =>
      confirm({
        title: `Merge #${pr.number}?`,
        description: mergeConfirmText(pr, current.settings),
        confirmText: ahead.jobs > 0 ? 'Queue merge' : 'Merge',
        onConfirm: () =>
          act(
            {
              kind: 'merge',
              key: `pr:${pr.number}`,
              prs: [pr.number],
              label: `Merge #${pr.number} ${pr.title}`,
              failTitle: `Couldn't merge #${pr.number}`,
            },
            async () => {
              await deployments.merge(pr);
              notify.success({
                title: `Merged #${pr.number}`,
                message: `It is in the next release; ${pr.branch} was deleted.`,
              });
            }
          ),
      }),
    [act, ahead, confirm, deployments]
  );

  const close = useCallback(
    (pr: ReleasePull) =>
      confirm({
        title: `Close #${pr.number}?`,
        description: `Closes it on GitHub without merging. ${pr.branch} is kept, so it can be reopened there.`,
        confirmText: ahead.jobs > 0 ? 'Queue close' : 'Close',
        onConfirm: () =>
          act(
            {
              kind: 'close',
              key: `pr:${pr.number}`,
              prs: [pr.number],
              label: `Close #${pr.number} ${pr.title}`,
              failTitle: `Couldn't close #${pr.number}`,
            },
            async () => {
              await deployments.close(pr);
              notify.success({ title: `Closed #${pr.number}` });
            }
          ),
      }),
    [act, ahead, confirm, deployments]
  );

  const mergeAll = useCallback(
    (current: ReleaseState, prs: ReleasePull[]) =>
      confirm({
        title: `Merge ${prs.length} ready PR${prs.length === 1 ? '' : 's'}?`,
        description: listed(
          `Merges each into ${current.settings?.baseBranch ?? 'stage'} with a merge commit, oldest first, and deletes its branch. Drafts and ones with conflicts are skipped.`,
          prs
        ),
        confirmText: ahead.jobs > 0 ? 'Queue merges' : 'Merge all',
        onConfirm: () =>
          act(
            {
              kind: 'merge',
              prs: prs.map(pr => pr.number),
              label: `Merge ${prs.length} ready PR${prs.length === 1 ? '' : 's'}: ${prs.map(pr => `#${pr.number}`).join(', ')}`,
              failTitle: "Couldn't merge them",
            },
            async () => {
              const result = await deployments.mergeAll(
                prs.map(pr => pr.number)
              );
              const skipped = result.skipped
                .map(s => `#${s.number} (${s.why})`)
                .join(', ');
              (result.skipped.length ? notify.error : notify.success)({
                title: `Merged ${result.merged.length}`,
                message: skipped ? `Skipped ${skipped}.` : undefined,
              });
            }
          ),
      }),
    [act, ahead, confirm, deployments]
  );

  // Not queued: it only hands the pull request to Claude, which runs apart.
  const fix = useCallback(
    (current: ReleaseState, pr: ReleasePull) => {
      if (!agent) return;
      deployments
        .fixWithClaude(agent, pr, current.tasks[pr.number]?.[0])
        .then(() =>
          notify.success({
            title: `Sent #${pr.number} to Claude to fix`,
            message: `${agent.name} on ${agent.deviceKey} is on it. Questions it asks come to you as notifications.`,
          })
        )
        .catch(err =>
          notify.error({
            title: "Couldn't send it to Claude",
            message: errorMessage(err),
          })
        );
    },
    [agent, deployments]
  );

  const settingsButton = (
    <Button
      variant="plain"
      onClick={() => setSettingsOpen(true)}
      data-testid="release-settings-open"
    >
      ⚙ Repo settings
    </Button>
  );

  const dialog = settingsOpen ? (
    <RepoSettingsDialog
      initial={state?.settings ?? defaultReleaseSettings(deployInfo)}
      token={state?.token ?? { source: null }}
      onClose={() => setSettingsOpen(false)}
      onOpenSecrets={
        openSecrets
          ? () => {
              setSettingsOpen(false);
              openSecrets();
            }
          : null
      }
    />
  ) : null;

  const header = (
    <div className={styles.header}>
      <span className={styles.githubBar}>
        {state ? `Read from GitHub ${readAgo(state.fetchedAt)}` : null}
        {state ? (
          <button
            className={styles.link}
            disabled={refreshing}
            onClick={refresh}
            data-testid="release-refresh"
          >
            {refreshing ? 'Reading…' : 'Refresh'}
          </button>
        ) : null}
      </span>
      {settingsButton}
    </div>
  );

  if (state === undefined) {
    return (
      <div className={styles.content} data-testid="deployments-view">
        {header}
        <div className={styles.empty}>Reading GitHub…</div>
        {dialog}
      </div>
    );
  }

  if (state === null) {
    return (
      <div className={styles.content} data-testid="deployments-view">
        {header}
        <div className={styles.empty} data-testid="release-error">
          Couldn&apos;t read the release state: {error ?? 'no answer'}.{' '}
          <Button variant="plain" onClick={refresh}>
            Try again
          </Button>
        </div>
        {dialog}
      </div>
    );
  }

  const blocker = releaseBlocker(state);

  return (
    <div className={styles.content} data-testid="deployments-view">
      {header}
      {error ? (
        <div className={styles.runError}>
          Couldn&apos;t refresh: {error}. Showing what was read{' '}
          {readAgo(state.fetchedAt)}.
        </div>
      ) : null}
      {blocker === 'no-settings' ? (
        <section className={styles.card} data-testid="release-setup">
          <div className={styles.sectionTitle}>Set up releases</div>
          <div className={styles.cardLine}>
            Name the repo this page releases, the branch its pull requests merge
            into, the branch prod deploys from and the workflow that deploys it.
          </div>
          <div className={styles.cardActions}>
            <Button variant="primary" onClick={() => setSettingsOpen(true)}>
              Set up releases…
            </Button>
          </div>
        </section>
      ) : blocker === 'no-token' ? (
        <section className={styles.card} data-testid="release-no-token">
          <div className={styles.cardLine}>{tokenMissingText(isMobile)}</div>
          {openSecrets ? (
            <div className={styles.cardActions}>
              <Button variant="primary" onClick={openSecrets}>
                Open Secrets
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
      {state.error ? (
        <div className={styles.runError} data-testid="release-state-error">
          {state.error}
        </div>
      ) : null}
      {blocker ? null : (
        <>
          <ActionQueue jobs={jobs} onCancel={id => queue.cancel(id)} />
          <ProductionCard
            state={state}
            ahead={ahead}
            queued={queued}
            onRelease={() => release(state)}
            onRedeploy={() => redeploy(state)}
            onRollback={rollback}
            onRetry={retry}
            onOpenFlags={() => workbench.open('/feature-flags')}
          />
          <AndroidCard state={state} busy={queued('apk')} onBuild={buildApk} />
          <NextRelease
            state={state}
            ahead={ahead}
            onRelease={() => release(state)}
          />
          <OpenPulls
            state={state}
            queued={pulls}
            agent={agent}
            onMerge={pr => merge(state, pr)}
            onMergeAll={prs => mergeAll(state, prs)}
            onClose={close}
            onFix={pr => fix(state, pr)}
          />
          <ReleaseHistory
            state={state}
            busy={queued('rollback')}
            onRedeployThis={rollback}
            onChecked={() => {
              deployments.refreshRelease({ fresh: true }).catch(() => {});
            }}
          />
        </>
      )}
      {dialog}
    </div>
  );
};

import { Button, notify, useConfirmModal } from '@notesgraph/component';
import {
  AgentsService,
  apkConfirmText,
  defaultReleaseSettings,
  DeploymentsService,
  mergeConfirmText,
  releaseBlocker,
  releaseConfirmText,
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
  // The action under way, so the others wait for it.
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => deployments.pollRelease(), [deployments]);
  // Prefills the set-up dialog's repo when the server has no state to say.
  useEffect(() => {
    deployments.refreshDeployInfo().catch(() => {});
  }, [deployments]);

  const openSecrets = isMobile ? null : () => workbench.open('/secrets');
  const refresh = useCallback(() => {
    setBusy('refresh');
    deployments
      .refreshRelease({ fresh: true })
      .catch(() => {})
      .finally(() => setBusy(null));
  }, [deployments]);

  /** Run one of the screen's actions, saying how it went. */
  const act = useCallback(
    async (name: string, failTitle: string, fn: () => Promise<void>) => {
      setBusy(name);
      try {
        await fn();
      } catch (err) {
        notify.error({ title: failTitle, message: errorMessage(err) });
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const confirm = useCallback(
    (opts: {
      title: string;
      description: ReactNode;
      confirmText: string;
      onConfirm: () => Promise<void>;
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
      const sha = current.next.sha;
      if (!sha) return;
      confirm({
        title: `Release ${current.next.prs.length} PR${current.next.prs.length === 1 ? '' : 's'}?`,
        description: listed(releaseConfirmText(current), current.next.prs),
        confirmText: 'Release',
        onConfirm: () =>
          act('release', "Couldn't release", async () => {
            const { run } = await deployments.release(sha);
            notify.success({
              title: `Releasing ${sha7(sha)}`,
              message: run
                ? `Deploy run ${run.id} started.`
                : 'The deploy was started; its run shows here once GitHub lists it.',
            });
          }),
      });
    },
    [act, confirm, deployments]
  );

  const redeploy = useCallback(
    (current: ReleaseState) => {
      const deploy = current.settings?.deployBranch ?? 'main';
      confirm({
        title: `Redeploy ${deploy}?`,
        description: `Builds and deploys ${deploy} (${sha7(current.production.mainSha)}) again with ${current.settings?.workflowFile ?? 'the deploy workflow'}.`,
        confirmText: 'Redeploy',
        onConfirm: () =>
          act('redeploy', "Couldn't redeploy", async () => {
            await deployments.redeploy();
            notify.success({ title: `Redeploying ${deploy}` });
          }),
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
          act('rollback', "Couldn't roll back", async () => {
            await deployments.rollback(imageSha);
            notify.success({ title: `Rolling back to ${sha7(imageSha)}` });
          }),
      }),
    [act, confirm, deployments]
  );

  const retry = useCallback(
    (runId: number) =>
      act('retry', "Couldn't retry the deploy", async () => {
        await deployments.retry(runId);
        notify.success({ title: `Retrying run ${runId}` });
      }),
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
          act('apk', "Couldn't start the APK build", async () => {
            const { run } = await deployments.buildApk(ref, force);
            notify.success({
              title: `Building the APK from ${ref}`,
              message: run
                ? `Run ${run.id} started.`
                : 'The build was started; its run shows here once GitHub lists it.',
            });
          }),
      }),
    [act, confirm, deployments]
  );

  const merge = useCallback(
    (current: ReleaseState, pr: ReleasePull) =>
      confirm({
        title: `Merge #${pr.number}?`,
        description: mergeConfirmText(pr, current.settings),
        confirmText: 'Merge',
        onConfirm: () =>
          act('merge', `Couldn't merge #${pr.number}`, async () => {
            await deployments.merge(pr);
            notify.success({
              title: `Merged #${pr.number}`,
              message: `It is in the next release; ${pr.branch} was deleted.`,
            });
          }),
      }),
    [act, confirm, deployments]
  );

  const mergeAll = useCallback(
    (current: ReleaseState, prs: ReleasePull[]) =>
      confirm({
        title: `Merge ${prs.length} ready PR${prs.length === 1 ? '' : 's'}?`,
        description: listed(
          `Merges each into ${current.settings?.baseBranch ?? 'stage'} with a merge commit, oldest first, and deletes its branch. Drafts and ones with conflicts are skipped.`,
          prs
        ),
        confirmText: 'Merge all',
        onConfirm: () =>
          act('merge-all', "Couldn't merge them", async () => {
            const result = await deployments.mergeAll(prs.map(pr => pr.number));
            const skipped = result.skipped
              .map(s => `#${s.number} (${s.why})`)
              .join(', ');
            (result.skipped.length ? notify.error : notify.success)({
              title: `Merged ${result.merged.length}`,
              message: skipped ? `Skipped ${skipped}.` : undefined,
            });
          }),
      }),
    [act, confirm, deployments]
  );

  const fix = useCallback(
    (current: ReleaseState, pr: ReleasePull) => {
      if (!agent) return;
      act('fix', "Couldn't send it to Claude", async () => {
        await deployments.fixWithClaude(
          agent,
          pr,
          current.tasks[pr.number]?.[0]
        );
        notify.success({
          title: `Sent #${pr.number} to Claude to fix`,
          message: `${agent.name} on ${agent.deviceKey} is on it. Questions it asks come to you as notifications.`,
        });
      }).catch(() => {});
    },
    [act, agent, deployments]
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
            disabled={busy !== null}
            onClick={refresh}
            data-testid="release-refresh"
          >
            {busy === 'refresh' ? 'Reading…' : 'Refresh'}
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
  const isBusy = busy !== null;

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
          <ProductionCard
            state={state}
            busy={isBusy}
            onRelease={() => release(state)}
            onRedeploy={() => redeploy(state)}
            onRollback={rollback}
            onRetry={id => void retry(id)}
            onOpenFlags={() => workbench.open('/feature-flags')}
          />
          <AndroidCard state={state} busy={isBusy} onBuild={buildApk} />
          <NextRelease
            state={state}
            busy={isBusy}
            onRelease={() => release(state)}
          />
          <OpenPulls
            state={state}
            busy={isBusy}
            agent={agent}
            onMerge={pr => merge(state, pr)}
            onMergeAll={prs => mergeAll(state, prs)}
            onFix={pr => fix(state, pr)}
          />
          <ReleaseHistory
            state={state}
            busy={isBusy}
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

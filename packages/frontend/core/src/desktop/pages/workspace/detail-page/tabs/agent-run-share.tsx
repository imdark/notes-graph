import { Button, notify } from '@notesgraph/component';
import {
  RemoteAgentRunnerService,
  type RunShare,
} from '@notesgraph/core/modules/agents';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { useService } from '@notesgraph/infra';
import { useCallback, useEffect, useState } from 'react';

import * as styles from './agents.css';

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/**
 * A device run's public link: make it (and copy it), copy it again, refresh
 * the snapshot it shows, or turn it off. The link shows a copy taken when
 * shared, so a run still going needs "Update snapshot" to show more.
 */
export const AgentRunShare = ({ jobId }: { jobId: string }) => {
  const t = useI18n();
  const remoteRunner = useService(RemoteAgentRunnerService);
  const workspaceId = useService(WorkspaceService).workspace.id;
  const [share, setShare] = useState<RunShare | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setShare(null);
    remoteRunner
      .getShare(workspaceId, jobId)
      .then(found => !cancelled && setShare(found))
      // No link to show is the right fallback; the Share button still works.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [remoteRunner, workspaceId, jobId]);

  const copy = useCallback(
    (url: string) =>
      navigator.clipboard
        .writeText(url)
        .then(() =>
          notify.success({ title: t['com.notesgraph.agent-run.share.copied']() })
        )
        .catch(() => notify.error({ title: "Couldn't copy" })),
    [t]
  );

  const createOrRefresh = useCallback(() => {
    setBusy(true);
    remoteRunner
      .share(workspaceId, jobId)
      .then(next => {
        setShare(next);
        return copy(next.url);
      })
      .catch(err =>
        notify.error({
          title: t['com.notesgraph.agent-run.share.failed'](),
          message: errorMessage(err),
        })
      )
      .finally(() => setBusy(false));
  }, [copy, jobId, remoteRunner, t, workspaceId]);

  const revoke = useCallback(() => {
    setBusy(true);
    remoteRunner
      .unshare(workspaceId, jobId)
      .then(() => {
        setShare(null);
        notify.success({ title: t['com.notesgraph.agent-run.share.revoked']() });
      })
      .catch(err =>
        notify.error({
          title: t['com.notesgraph.agent-run.share.failed'](),
          message: errorMessage(err),
        })
      )
      .finally(() => setBusy(false));
  }, [jobId, remoteRunner, t, workspaceId]);

  if (!share) {
    return (
      <div className={styles.attachRow}>
        <Button
          disabled={busy}
          onClick={createOrRefresh}
          tooltip={t['com.notesgraph.agent-run.share.tooltip']()}
          data-testid="agent-run-share"
        >
          {t['com.notesgraph.agent-run.share.button']()}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.logDialogBody} data-testid="agent-run-shared">
      <div className={styles.attachRow}>
        <code className={styles.attachCommand}>{share.url}</code>
        <Button onClick={() => void copy(share.url)}>
          {t['com.notesgraph.agent-run.share.copy']()}
        </Button>
        <Button disabled={busy} onClick={createOrRefresh}>
          {t['com.notesgraph.agent-run.share.refresh']()}
        </Button>
        <Button
          variant="plain"
          disabled={busy}
          onClick={revoke}
          data-testid="agent-run-share-revoke"
        >
          {t['com.notesgraph.agent-run.share.revoke']()}
        </Button>
      </div>
      <span className={styles.hint}>
        {t['com.notesgraph.agent-run.share.hint']()} ·{' '}
        {new Date(share.sharedAt * 1000).toLocaleString()}
      </span>
    </div>
  );
};

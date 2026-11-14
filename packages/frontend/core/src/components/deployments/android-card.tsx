import { Button, Input, Menu, MenuItem, Modal } from '@notesgraph/component';
import {
  apkPendingText,
  apkRefError,
  apkRunLine,
  formatDuration,
  type ReleaseState,
  sha7,
} from '@notesgraph/core/modules/agents';
import { useState } from 'react';

import { pillClass, when } from './shared';
import * as styles from './styles.css';

const RunLink = ({ url, id }: { url: string; id: number }) => (
  <a className={styles.link} href={url} target="_blank" rel="noreferrer">
    run {id}
  </a>
);

/** Asks which branch or commit "Force from branch…" builds. */
const RefDialog = ({
  initial,
  onClose,
  onBuild,
}: {
  initial: string;
  onClose: () => void;
  onBuild: (ref: string) => void;
}) => {
  const [ref, setRef] = useState(initial);
  const error = apkRefError(ref);
  const go = () => {
    if (error) return;
    onBuild(ref.trim());
  };
  return (
    <Modal
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title="Build the APK from a branch"
      description="A branch or a commit; it is built even if the app didn't change."
      width={420}
    >
      <div className={styles.dialogBody} data-testid="apk-ref-dialog">
        <label className={styles.field}>
          Branch or commit
          <Input
            value={ref}
            onChange={setRef}
            onEnter={go}
            placeholder="stage"
            autoFocus
            data-testid="apk-ref-input"
          />
        </label>
        {error && ref ? <span className={styles.runError}>{error}</span> : null}
        <div className={styles.dialogActions}>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={go}
            disabled={!!error}
            data-testid="apk-ref-build"
          >
            Build…
          </Button>
        </div>
      </div>
    </Modal>
  );
};

/**
 * The Android app under Production: which commit the downloadable APK was
 * built from, what its newest build (build-apk.yml) did, and Build APK.
 */
export const AndroidCard = ({
  state,
  busy,
  onBuild,
}: {
  state: ReleaseState;
  busy: boolean;
  onBuild: (ref: string, force: boolean) => void;
}) => {
  const [asking, setAsking] = useState(false);
  const android = state.android;
  // An older server says nothing about the APK.
  if (android === undefined || android === null) return null;
  const deploy = state.settings?.deployBranch ?? 'main';
  const base = state.settings?.baseBranch ?? 'stage';
  const line = apkRunLine(android);
  const published = android.published;
  const pending = apkPendingText(android, deploy);
  const off = busy || android.building;

  return (
    <section className={styles.card} data-testid="release-android">
      <div className={styles.sectionTitle}>Android app</div>
      <div className={styles.cardLine} data-testid="apk-published">
        {published ? (
          <>
            <span>APK built from</span>
            <code className={styles.sha}>{sha7(published.sha)}</code>
            {published.ref && !published.sha.startsWith(published.ref) ? (
              <span>({published.ref})</span>
            ) : null}
            {published.builtAt ? (
              <span>· {when(published.builtAt)}</span>
            ) : null}
            {published.runUrl ? (
              <a
                className={styles.link}
                href={published.runUrl}
                target="_blank"
                rel="noreferrer"
              >
                run
              </a>
            ) : null}
          </>
        ) : (
          <span>No APK published by the pipeline yet.</span>
        )}
      </div>
      {pending && published ? (
        <div className={styles.sectionHint} data-testid="apk-pending">
          {pending} {sha7(published.sha)}.
        </div>
      ) : null}
      {line?.kind === 'building' ? (
        <div className={styles.cardLine} data-testid="apk-building">
          <span className={pillClass('busy')}>
            {line.run.status === 'waiting' ? 'Waiting' : 'Building'}
          </span>
          <span>
            APK from {line.ref}
            {line.run.forced ? ' (forced)' : ''}, started{' '}
            {when(line.run.startedAt)} (
            {formatDuration(Date.now() - Date.parse(line.run.startedAt)) ||
              'just now'}{' '}
            so far)
          </span>
          <RunLink url={line.run.url} id={line.run.id} />
        </div>
      ) : line?.kind === 'failed' ? (
        <div className={styles.cardLine} data-testid="apk-failed">
          <span className={styles.runError}>
            The APK build from {line.ref}{' '}
            {line.run.conclusion === 'cancelled' ? 'was cancelled' : 'failed'}.
          </span>
          <a
            className={styles.link}
            href={line.run.url}
            target="_blank"
            rel="noreferrer"
          >
            Open log
          </a>
        </div>
      ) : line?.kind === 'skipped' ? (
        <div className={styles.cardLine} data-testid="apk-skipped">
          <span>
            Skipped: no app changes
            {line.since ? ` since ${sha7(line.since)}` : ''} ·{' '}
            {when(line.run.startedAt)}
          </span>
          <RunLink url={line.run.url} id={line.run.id} />
        </div>
      ) : line?.kind === 'built' && line.run.url !== published?.runUrl ? (
        <div className={styles.cardLine}>
          <span>
            Last build from {line.ref} · {when(line.run.startedAt)}
            {line.run.durationMs
              ? ` · ${formatDuration(line.run.durationMs)}`
              : ''}
          </span>
          <RunLink url={line.run.url} id={line.run.id} />
        </div>
      ) : null}
      {android.error ? (
        <div className={styles.sectionHint} data-testid="apk-error">
          {android.error}
        </div>
      ) : null}
      <div className={styles.cardActions}>
        <Menu
          items={
            <>
              <MenuItem
                onClick={() => onBuild(deploy, false)}
                data-testid="apk-build-changed"
              >
                From {deploy} (if changed)
              </MenuItem>
              <MenuItem
                onClick={() => onBuild(deploy, true)}
                data-testid="apk-build-force"
              >
                Force from {deploy}
              </MenuItem>
              <MenuItem
                onClick={() => setAsking(true)}
                data-testid="apk-build-branch"
              >
                Force from branch…
              </MenuItem>
            </>
          }
        >
          <Button
            disabled={off || !state.settings}
            tooltip={android.building ? 'An APK build is running.' : undefined}
            data-testid="apk-build"
          >
            Build APK ▾
          </Button>
        </Menu>
      </div>
      {asking ? (
        <RefDialog
          initial={base}
          onClose={() => setAsking(false)}
          onBuild={ref => {
            setAsking(false);
            onBuild(ref, true);
          }}
        />
      ) : null}
    </section>
  );
};

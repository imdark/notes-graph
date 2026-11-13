import { Button, Input, Modal, notify } from '@notesgraph/component';
import {
  DeploymentsService,
  type ReleaseSettings,
  type ReleaseToken,
  tokenMissingText,
  validateReleaseSettings,
} from '@notesgraph/core/modules/agents';
import { useService } from '@notesgraph/infra';
import { useState } from 'react';

import { errorMessage } from './shared';
import * as styles from './styles.css';

const tokenLine = (token: ReleaseToken, mobile: boolean) =>
  token.source === 'secret'
    ? 'Token: the workspace’s GITHUB_TOKEN secret.'
    : token.source === 'env'
      ? 'Token: the server’s own (NOTESGRAPH_GITHUB_TOKEN); a GITHUB_TOKEN secret would take its place.'
      : tokenMissingText(mobile);

/**
 * The repo the screen releases: where pull requests merge, what prod
 * deploys from, the workflow that deploys, and whether the token works.
 * Rendered only while open, so it starts from `initial` each time.
 */
export const RepoSettingsDialog = ({
  initial,
  token,
  onClose,
  onOpenSecrets,
}: {
  initial: ReleaseSettings;
  token: ReleaseToken;
  onClose: () => void;
  /** Null on the phone, which has no Secrets page. */
  onOpenSecrets: (() => void) | null;
}) => {
  const deployments = useService(DeploymentsService);
  const [repo, setRepo] = useState(initial.repo);
  const [baseBranch, setBaseBranch] = useState(initial.baseBranch);
  const [deployBranch, setDeployBranch] = useState(initial.deployBranch);
  const [workflowFile, setWorkflowFile] = useState(initial.workflowFile);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const checked = validateReleaseSettings({
    repo,
    baseBranch,
    deployBranch,
    workflowFile,
  });

  const save = () => {
    if (!checked.ok) return;
    setSaving(true);
    deployments
      .saveSettings(checked.settings)
      .then(() => {
        notify.success({ title: 'Repo settings saved' });
        onClose();
      })
      .catch(err =>
        notify.error({
          title: "Couldn't save the repo settings",
          message: errorMessage(err),
        })
      )
      .finally(() => setSaving(false));
  };

  const runTest = () => {
    setTesting(true);
    setTest(null);
    deployments
      .testToken()
      .then(result =>
        setTest(
          result.ok
            ? { ok: true, text: 'GitHub answered: the token works.' }
            : { ok: false, text: result.error ?? 'The token doesn’t work.' }
        )
      )
      .catch(err => setTest({ ok: false, text: errorMessage(err) }))
      .finally(() => setTesting(false));
  };

  const field = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    placeholder: string,
    testId: string
  ) => (
    <label className={styles.field}>
      {label}
      <Input
        value={value}
        onChange={onChange}
        onEnter={save}
        placeholder={placeholder}
        data-testid={testId}
      />
    </label>
  );

  return (
    <Modal
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title="Repo settings"
      description="The repo this page releases, read from GitHub by the server."
      width={480}
    >
      <div className={styles.dialogBody} data-testid="release-settings">
        {field('Repo', repo, setRepo, 'owner/name', 'release-settings-repo')}
        {field(
          'Base branch (pull requests merge here)',
          baseBranch,
          setBaseBranch,
          'stage',
          'release-settings-base'
        )}
        {field(
          'Deploy branch (prod deploys from here)',
          deployBranch,
          setDeployBranch,
          'main',
          'release-settings-deploy'
        )}
        {field(
          'Deploy workflow file',
          workflowFile,
          setWorkflowFile,
          'deploy-prod.yml',
          'release-settings-workflow'
        )}
        <div className={styles.cardLine}>
          <span>{tokenLine(token, !onOpenSecrets)}</span>
          {onOpenSecrets ? (
            <button className={styles.link} onClick={onOpenSecrets}>
              Secrets
            </button>
          ) : null}
        </div>
        <div className={styles.cardLine}>
          <Button
            onClick={runTest}
            loading={testing}
            disabled={!token.source}
            tooltip="Asks GitHub whether the token reaches the saved repo"
            data-testid="release-settings-test"
          >
            Test
          </Button>
          {test ? (
            <span
              className={test.ok ? styles.badgeGood : styles.runError}
              data-testid="release-settings-test-result"
            >
              {test.text}
            </span>
          ) : null}
        </div>
        {checked.ok ? null : (
          <span className={styles.runError}>{checked.error}</span>
        )}
        <div className={styles.dialogActions}>
          <Button variant="plain" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={save}
            loading={saving}
            disabled={!checked.ok}
            data-testid="release-settings-save"
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
};

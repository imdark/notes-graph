import { Input } from '@notesgraph/component';
import { AgentRunLogDialog } from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/agent-run-log';
import type { VerifyTarget } from '@notesgraph/core/modules/agents';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { useLiveData, useService } from '@notesgraph/infra';
import { useState } from 'react';

import { VerifyButton } from '../verify-button';
import * as styles from './styles.css';

/** Verify on the Deployments page, with the window its agent's run opens in. */
export const VerifyAction = ({
  target,
  disabled,
}: {
  target: VerifyTarget;
  disabled?: boolean;
}) => {
  const [runId, setRunId] = useState<string | null>(null);
  return (
    <>
      <VerifyButton target={target} onOpenRun={setRunId} disabled={disabled} />
      <AgentRunLogDialog runId={runId} onClose={() => setRunId(null)} />
    </>
  );
};

/**
 * Verify any branch by name: one an agent left without a pull request (its
 * run ended before it could open one) is on no list on this page.
 */
export const VerifyBranch = ({
  repo,
  base,
}: {
  repo: string;
  base: string;
}) => {
  const [branch, setBranch] = useState('');
  const name = branch.trim();
  const enabled = useLiveData(
    useService(FeatureFlagService).flags.enable_verify_buttons.$
  );
  if (!enabled) return null;
  return (
    <div className={styles.verifyBranch} data-testid="verify-branch-box">
      <Input
        value={branch}
        onChange={setBranch}
        placeholder="Verify a branch: its name, e.g. cloud-147-…"
        data-testid="verify-branch-input"
      />
      <VerifyAction
        target={{ kind: 'branch', repo, branch: name, base }}
        disabled={!BRANCH_RE.test(name)}
      />
    </div>
  );
};

/** A plausible git branch name (git itself has the final word). */
const BRANCH_RE = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*$/;

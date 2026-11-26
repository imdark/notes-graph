import { Button, notify } from '@notesgraph/component';
import {
  VERIFICATIONS_DOC_TITLE,
  verifyKey,
  VerifyService,
  type VerifyTarget,
} from '@notesgraph/core/modules/agents';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

const WHAT: Record<VerifyTarget['kind'], string> = {
  run: 'this run',
  pull: 'this pull request',
  branch: 'this branch',
};

/**
 * Verify: starts the Verify agent on a run, a pull request or a branch (see
 * VerifyService), then Show agent opens that agent's run, which the caller
 * shows with `onOpenRun` (the run log swaps to it; the Deployments page opens
 * a run window, see VerifyAction).
 */
export const VerifyButton = ({
  target,
  onOpenRun,
  disabled,
}: {
  target: VerifyTarget;
  onOpenRun: (runId: string) => void;
  disabled?: boolean;
}) => {
  const verifyService = useService(VerifyService);
  const enabled = useLiveData(
    useService(FeatureFlagService).flags.enable_verify_buttons.$
  );
  const key = verifyKey(target);
  const started = useLiveData(
    useMemo(() => verifyService.watch(key), [verifyService, key])
  );
  const [busy, setBusy] = useState(false);

  const verify = useCallback(() => {
    setBusy(true);
    verifyService
      .verify(target)
      .then(({ runId }) => {
        if (runId) {
          onOpenRun(runId);
          return;
        }
        notify.success({
          title: 'Verifying',
          message: `The verdict goes under a to-do in the ${VERIFICATIONS_DOC_TITLE} note. The Agents page shows the run.`,
        });
      })
      .catch(err =>
        notify.error({
          title: "Couldn't start the verification",
          message: err instanceof Error ? err.message : String(err),
        })
      )
      .finally(() => setBusy(false));
  }, [verifyService, target, onOpenRun]);

  if (!enabled) return null;
  return (
    <>
      <Button
        variant="plain"
        onClick={verify}
        loading={busy}
        disabled={busy || disabled}
        tooltip={`An agent checks ${WHAT[target.kind]}: that the work exists, builds, passes its tests and does what its task asked. It changes nothing and writes its verdict in the ${VERIFICATIONS_DOC_TITLE} note.`}
        data-testid={`verify-${target.kind}`}
      >
        {started ? 'Verify again' : 'Verify'}
      </Button>
      {started?.runId ? (
        <Button
          variant="plain"
          onClick={() => onOpenRun(started.runId as string)}
          data-testid={`verify-${target.kind}-show`}
        >
          Show agent
        </Button>
      ) : null}
    </>
  );
};

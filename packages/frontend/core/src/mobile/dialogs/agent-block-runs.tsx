import { Modal } from '@notesgraph/component';
import { AgentRunLogDialog } from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/agent-run-log';
import {
  RunRow,
  useMinuteTick,
} from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/agent-run-row';
import * as styles from '@notesgraph/core/desktop/pages/workspace/detail-page/tabs/agents.css';
import { AgentRunsStore } from '@notesgraph/core/modules/agents';
import type { DialogComponentProps } from '@notesgraph/core/modules/dialogs';
import type { WORKSPACE_DIALOG_SCHEMA } from '@notesgraph/core/modules/dialogs/constant';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

/**
 * The agent runs that worked on a block, opened by tapping the robot at the
 * end of its line. The desktop anchors a menu to the chip; a phone has no
 * room for one, so a single run opens straight to its log and several are
 * listed in a modal first.
 */
export const AgentBlockRunsDialog = ({
  close,
  runIds,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['agent-block-runs']>) => {
  const runsStore = useService(AgentRunsStore);
  const workbench = useService(WorkbenchService).workbench;
  const now = useMinuteTick();
  const all = useLiveData(useMemo(() => runsStore.watchRuns(), [runsStore]));
  const runs = useMemo(
    () => all.filter(run => runIds.includes(run.id)),
    [all, runIds]
  );
  const [logRunId, setLogRunId] = useState<string | null>(
    runIds.length === 1 ? runIds[0] : null
  );

  const openAgentsPage = useCallback(() => {
    workbench.open('/agents');
    close();
  }, [close, workbench]);

  if (logRunId) {
    return <AgentRunLogDialog runId={logRunId} onClose={close} />;
  }

  return (
    <Modal
      open
      onOpenChange={open => !open && close()}
      title="Agent runs on this block"
    >
      <div className={styles.section} data-testid="agent-block-runs">
        {runs.length === 0 ? (
          <p className={styles.empty}>
            These runs have been deleted from your run history.
          </p>
        ) : (
          <div className={styles.runList}>
            {runs.map(run => (
              <RunRow key={run.id} run={run} now={now} onOpen={setLogRunId} />
            ))}
          </div>
        )}
        <div className={styles.panelFooter}>
          <button
            className={styles.linkButton}
            onClick={openAgentsPage}
            data-testid="agent-block-runs-all"
          >
            All runs →
          </button>
        </div>
      </div>
    </Modal>
  );
};

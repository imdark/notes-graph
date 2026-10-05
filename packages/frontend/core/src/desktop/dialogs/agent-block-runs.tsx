import { Menu } from '@notesgraph/component';
import { AgentRunsStore } from '@notesgraph/core/modules/agents';
import type { DialogComponentProps } from '@notesgraph/core/modules/dialogs';
import type { WORKSPACE_DIALOG_SCHEMA } from '@notesgraph/core/modules/dialogs/constant';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { cssVarV2 } from '@toeverything/theme/v2';
import { useCallback, useMemo, useState } from 'react';

import { AgentRunLogDialog } from '../pages/workspace/detail-page/tabs/agent-run-log';
import {
  RunRow,
  useMinuteTick,
} from '../pages/workspace/detail-page/tabs/agent-run-row';
import * as styles from '../pages/workspace/detail-page/tabs/agents.css';
import { useRunActions } from '../pages/workspace/detail-page/tabs/use-run-actions';

/**
 * The agent runs that worked on a block, opened from the runs chip at the end
 * of its line. Picking one swaps the list for that run's log.
 */
export const AgentBlockRunsDialog = ({
  close,
  runIds,
  position,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['agent-block-runs']>) => {
  const runsStore = useService(AgentRunsStore);
  const workbench = useService(WorkbenchService).workbench;
  const runActions = useRunActions({ openDoc: false });
  const now = useMinuteTick();
  const all = useLiveData(useMemo(() => runsStore.watchRuns(), [runsStore]));
  const runs = useMemo(
    () => all.filter(run => runIds.includes(run.id)),
    [all, runIds]
  );
  const [logRunId, setLogRunId] = useState<string | null>(null);

  const onMenuOpenChange = useCallback(
    (open: boolean) => {
      // Closing the list to show a log isn't closing the dialog.
      if (!open && !logRunId) close();
    },
    [close, logRunId]
  );
  const openAgentsPage = useCallback(() => {
    workbench.open('/agents');
    close();
  }, [close, workbench]);

  if (logRunId) {
    return <AgentRunLogDialog runId={logRunId} onClose={close} />;
  }

  return (
    <Menu
      rootOptions={{ modal: true, open: true, onOpenChange: onMenuOpenChange }}
      contentOptions={{
        side: 'bottom',
        sideOffset: 4,
        align: 'end',
        style: {
          padding: 12,
          borderRadius: 8,
          width: 380,
          background: cssVarV2('layer/background/primary'),
        },
      }}
      items={
        <div className={styles.section} data-testid="agent-block-runs">
          <div className={styles.panelFooter}>
            <span className={styles.sectionLabel}>
              Agent runs on this block
            </span>
            <button
              className={styles.linkButton}
              onClick={openAgentsPage}
              data-testid="agent-block-runs-all"
            >
              All runs →
            </button>
          </div>
          {runs.length === 0 ? (
            <p className={styles.empty}>
              These runs have been deleted from your run history.
            </p>
          ) : (
            <div className={styles.runList}>
              {runs.map(run => (
                <RunRow
                  key={run.id}
                  run={run}
                  now={now}
                  onOpen={setLogRunId}
                  onRetry={run => {
                    runActions.retry(run);
                    close();
                  }}
                />
              ))}
            </div>
          )}
        </div>
      }
    >
      <div
        style={
          position
            ? {
                position: 'fixed',
                left: position[0],
                top: position[1],
                width: position[2],
                height: position[3],
              }
            : {
                position: 'fixed',
                left: '50%',
                top: '50%',
                width: 0,
                height: 0,
              }
        }
      />
    </Menu>
  );
};

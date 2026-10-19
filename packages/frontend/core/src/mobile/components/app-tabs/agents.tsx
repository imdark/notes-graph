import { AiIcon } from '@blocksuite/icons/rc';
import {
  AgentRunSessionService,
  AgentRunsStore,
} from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback, useMemo } from 'react';

import { agentsDot, agentsIcon } from './styles.css';
import { TabItem } from './tab-item';
import type { AppTabCustomFCProps } from './type';

/** The agent runs tab; dotted while a run is going, or one waits to be reviewed. */
export const AppTabAgents = ({ tab }: AppTabCustomFCProps) => {
  const workbench = useService(WorkbenchService).workbench;
  const sessionService = useService(AgentRunSessionService);
  const runsStore = useService(AgentRunsStore);
  const sessions = useLiveData(sessionService.sessions$);
  const toReview = useLiveData(
    useMemo(() => runsStore.watchPendingReview(), [runsStore])
  );
  const busy = sessions.some(session => session.running) || toReview.length > 0;

  const handleOpen = useCallback(() => {
    workbench.open('/agents', { at: 'active', replaceHistory: true });
  }, [workbench]);

  return (
    <TabItem onClick={handleOpen} id={tab.key} label="Agents">
      <span className={agentsIcon} data-testid="app-tab-agents">
        <AiIcon />
        {busy ? <span className={agentsDot} /> : null}
      </span>
    </TabItem>
  );
};

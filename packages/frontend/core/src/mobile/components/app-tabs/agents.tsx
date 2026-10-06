import { AiIcon } from '@blocksuite/icons/rc';
import { AgentRunSessionService } from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
import { useCallback } from 'react';

import { agentsDot, agentsIcon } from './styles.css';
import { TabItem } from './tab-item';
import type { AppTabCustomFCProps } from './type';

/** The agent runs tab; dotted while a run is going or waiting on you. */
export const AppTabAgents = ({ tab }: AppTabCustomFCProps) => {
  const workbench = useService(WorkbenchService).workbench;
  const sessionService = useService(AgentRunSessionService);
  const sessions = useLiveData(sessionService.sessions$);
  const busy = sessions.some(session => session.running);

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

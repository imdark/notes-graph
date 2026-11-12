import { Button, Checkbox, notify } from '@notesgraph/component';
import {
  type Agent,
  AgentIcon,
  AgentRunSessionService,
  AgentsService,
  useAgentsDownLast,
} from '@notesgraph/core/modules/agents';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useService } from '@notesgraph/infra';
import { useCallback, useMemo, useState } from 'react';

import * as styles from './capture.css';

/** The agents picked last time, so the next capture goes to them in one tap. */
const LAST_PICKED_KEY = 'capture:hand-off-agents';

const readLastPicked = (): string[] => {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_PICKED_KEY) ?? '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
};

/**
 * Picks the agents a capture is handed to, from the same list the agent pill
 * in a note offers (every enabled agent that works on a block or the whole
 * note), with the same "New agent…" way out. An agent that works on a whole
 * note runs on the note; one that only works on blocks runs on each bullet.
 * The Agents panel opens so the run can be followed, as from the pill.
 */
export const CaptureHandOff = ({
  docId,
  getBlockIds,
  onBeforeHandOff,
  onHandedOff,
  onCancel,
}: {
  docId: string;
  /** The capture's bullets, read after it has been written. */
  getBlockIds: () => string[];
  /** Writes what is on screen, so the agents read all of it. */
  onBeforeHandOff: () => void;
  onHandedOff: (agents: Agent[]) => void;
  onCancel: () => void;
}) => {
  const agentsService = useService(AgentsService);
  const sessions = useService(AgentRunSessionService);
  const workbench = useService(WorkbenchService).workbench;
  const dialogs = useService(WorkspaceDialogService);
  const blockAgents = useAgentsDownLast(
    useMemo(() => agentsService.agentsFor$('block'), [agentsService])
  );
  const docAgents = useAgentsDownLast(
    useMemo(() => agentsService.agentsFor$('doc'), [agentsService])
  );
  const agents = useMemo(
    () => [
      ...blockAgents,
      ...docAgents.filter(doc => !blockAgents.some(a => a.id === doc.id)),
    ],
    [blockAgents, docAgents]
  );

  const [picked, setPicked] = useState<string[]>(readLastPicked);
  const pickedAgents = useMemo(
    () => agents.filter(agent => picked.includes(agent.id)),
    [agents, picked]
  );

  const toggle = useCallback((id: string) => {
    setPicked(prev =>
      prev.includes(id) ? prev.filter(other => other !== id) : [...prev, id]
    );
  }, []);

  const handOff = useCallback(() => {
    if (!pickedAgents.length) return;
    localStorage.setItem(
      LAST_PICKED_KEY,
      JSON.stringify(pickedAgents.map(agent => agent.id))
    );
    onBeforeHandOff();
    const blockIds = getBlockIds();
    if (!BUILD_CONFIG.isMobileEdition) {
      workbench.openSidebar();
      workbench.activeView$.value.activeSidebarTab('agents');
    }
    const fail = (err: unknown) => {
      console.error(err);
      notify.error({
        title: "Couldn't start the agent",
        message: err instanceof Error ? err.message : String(err),
      });
    };
    for (const agent of pickedAgents) {
      if (agent.targets.includes('doc') || !blockIds.length) {
        sessions.start(agent, { kind: 'doc', docId }).catch(fail);
        continue;
      }
      for (const blockId of blockIds) {
        sessions.start(agent, { kind: 'block', docId, blockId }).catch(fail);
      }
    }
    onHandedOff(pickedAgents);
  }, [
    docId,
    getBlockIds,
    onBeforeHandOff,
    onHandedOff,
    pickedAgents,
    sessions,
    workbench,
  ]);

  const newAgent = useCallback(() => {
    dialogs.open('agent-editor', {}, agent => {
      if (agent) setPicked(prev => [...prev, agent.id]);
    });
  }, [dialogs]);

  if (!agents.length) {
    return (
      <div className={styles.handOff} data-testid="capture-hand-off">
        <span className={styles.handOffHint}>
          No agent is set up yet. Set one up to hand captures to it.
        </span>
        <div className={styles.handOffActions}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => workbench.open('/agents')}>
            Set up agents
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.handOff}
      role="group"
      aria-label="Agents to hand this capture to"
      data-testid="capture-hand-off"
    >
      <span className={styles.handOffLabel}>Which agents take this on?</span>
      <div className={styles.handOffList}>
        {agents.map(agent => (
          <label key={agent.id} className={styles.handOffAgent}>
            <Checkbox
              checked={picked.includes(agent.id)}
              onChange={() => toggle(agent.id)}
              data-testid={`capture-hand-off-${agent.id}`}
            />
            <span className={styles.handOffIcon}>
              <AgentIcon agent={agent} />
            </span>
            <span className={styles.handOffName}>{agent.name}</span>
          </label>
        ))}
      </div>
      <div className={styles.handOffActions}>
        <Button onClick={newAgent}>New agent…</Button>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!pickedAgents.length}
          onClick={handOff}
          data-testid="capture-hand-off-start"
        >
          {pickedAgents.length > 1
            ? `Hand off to ${pickedAgents.length} agents`
            : 'Hand off'}
        </Button>
      </div>
    </div>
  );
};

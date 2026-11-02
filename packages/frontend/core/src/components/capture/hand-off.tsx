import { Button, Checkbox } from '@notesgraph/component';
import {
  type Agent,
  AgentIcon,
  AgentRunSessionService,
  AgentsService,
} from '@notesgraph/core/modules/agents';
import { WorkbenchService } from '@notesgraph/core/modules/workbench';
import { useLiveData, useService } from '@notesgraph/infra';
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
 * Picks the agents a capture is handed to. Each one picked starts a run on
 * the whole note, the same as running it from the note's Agents panel.
 */
export const CaptureHandOff = ({
  docId,
  onBeforeHandOff,
  onHandedOff,
  onCancel,
}: {
  docId: string;
  /** Writes what is on screen, so the agents read all of it. */
  onBeforeHandOff: () => void;
  onHandedOff: (agents: Agent[]) => void;
  onCancel: () => void;
}) => {
  const agentsService = useService(AgentsService);
  const sessions = useService(AgentRunSessionService);
  const workbench = useService(WorkbenchService).workbench;
  const agents = useLiveData(agentsService.agentsFor$('doc'));

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
    for (const agent of pickedAgents) {
      sessions.start(agent, { kind: 'doc', docId }).catch(console.error);
    }
    onHandedOff(pickedAgents);
  }, [docId, onBeforeHandOff, onHandedOff, pickedAgents, sessions]);

  if (!agents.length) {
    return (
      <div className={styles.handOff} data-testid="capture-hand-off">
        <span className={styles.handOffHint}>
          No agent works on a whole note yet. Set one up to hand captures to it.
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

import { NoNetworkIcon } from '@blocksuite/icons/rc';

import { onDownDevice } from '../services/fleet';
import * as styles from './agent-down-mark.css';

/** What the mark says when hovered: why the agent is at the bottom. */
export const AGENT_DOWN_TITLE =
  'Monitoring reports the machine this agent runs on as down';

/**
 * Marks an agent whose machine monitoring reports down, in a list a person
 * picks an agent from. Nothing for an agent on a machine that is up.
 */
export const AgentDownMark = ({
  agent,
  down,
}: {
  agent: { deviceKey?: string };
  down: Set<string>;
}) =>
  onDownDevice(agent, down) ? (
    <span
      className={styles.downMark}
      title={AGENT_DOWN_TITLE}
      data-testid="agent-down-mark"
    >
      <NoNetworkIcon aria-hidden />
      Offline
    </span>
  ) : null;

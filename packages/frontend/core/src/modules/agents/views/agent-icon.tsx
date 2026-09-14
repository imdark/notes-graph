import { ToolIcon } from '@blocksuite/icons/rc';
import { type IconData, IconRenderer, IconType } from '@notesgraph/component';

import type { Agent } from '../stores/agents';

/**
 * An agent's icon, wherever one is shown.
 *
 * Three sources in priority order: the IconData a reader picked (emoji, a
 * built-in icon, or an AI-generated image), the bare emoji that rows written
 * before IconData existed still carry, and otherwise the generic agent icon.
 */
export const agentIconData = (
  agent: Pick<Agent, 'icon' | 'emoji'>
): IconData | undefined => {
  if (agent.icon) return agent.icon;
  if (agent.emoji) return { type: IconType.Emoji, unicode: agent.emoji };
  return undefined;
};

export const AgentIcon = ({
  agent,
}: {
  agent: Pick<Agent, 'icon' | 'emoji'>;
}) => (
  <IconRenderer data={agentIconData(agent)} fallback={<ToolIcon />} />
);

import { Entity, LiveData } from '@notesgraph/infra';

import type { Agent, AgentsStore } from '../stores/agents';

/**
 * The one list of agents the app reads from: this user's private agents and the
 * workspace's shared ones, merged. Both tables are reactive Yjs-backed ORM
 * tables, so there's nothing to revalidate — the list stays live on its own.
 */
export class Agents extends Entity {
  constructor(private readonly store: AgentsStore) {
    super();
  }

  readonly workspaceAgents$ = this.store.watchWorkspaceAgents();
  readonly personalAgents$ = this.store.watchPersonalAgents();

  /**
   * Personal agents first: when someone has taken the trouble to write their
   * own, that's the one they're looking for in a menu.
   */
  readonly agents$ = LiveData.computed(get => [
    ...get(this.personalAgents$),
    ...get(this.workspaceAgents$),
  ]);

  readonly enabledAgents$ = this.agents$.map(agents =>
    agents.filter(agent => agent.enabled)
  );

  agentById$(id: string): LiveData<Agent | undefined> {
    return this.agents$.map(agents => agents.find(agent => agent.id === id));
  }
}

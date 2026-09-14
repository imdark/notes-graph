import { LiveData, Service } from '@notesgraph/infra';

import type { Agents } from '../entities/agents';
import {
  type Agent,
  type AgentDraft,
  type AgentScope,
  DEFAULT_MAX_STEPS,
  type AgentsStore,
} from '../stores/agents';
import type { AgentTarget } from './target';

/** Read-only tools a phase-1 agent may be given. See tools.ts for the binding. */
export const DEFAULT_AGENT_TOOLS = [
  'read_document',
  'list_blocks',
  'semantic_search',
  'keyword_search',
  'search_blocks',
];

export class AgentsService extends Service {
  constructor(
    private readonly store: AgentsStore,
    private readonly agents: Agents
  ) {
    super();
  }

  readonly agents$ = this.agents.agents$;
  readonly personalAgents$ = this.agents.personalAgents$;
  readonly workspaceAgents$ = this.agents.workspaceAgents$;

  /**
   * The agents offerable for a target, in menu order. Filters on `enabled` and
   * on the agent declaring this target kind, so a doc-scoped agent never shows
   * up on a text selection.
   */
  agentsFor$(kind: AgentTarget['kind']): LiveData<Agent[]> {
    return this.agents.enabledAgents$.map(agents =>
      agents.filter(agent => agent.targets.includes(kind))
    );
  }

  newDraft(): AgentDraft {
    return {
      name: '',
      instructions: '',
      tools: [...DEFAULT_AGENT_TOOLS],
      targets: ['block', 'selection', 'doc'],
      output: 'panel',
      maxSteps: DEFAULT_MAX_STEPS,
      enabled: true,
    };
  }

  create(scope: AgentScope, draft: AgentDraft) {
    return this.store.create(scope, draft);
  }

  update(agent: Agent, patch: Partial<AgentDraft>) {
    this.store.update(agent, patch);
  }

  delete(agent: Agent) {
    this.store.delete(agent);
  }

  /** Copy into the other scope (shared <-> private) and drop the original. */
  move(agent: Agent, to: AgentScope) {
    return this.store.move(agent, to);
  }

  duplicate(agent: Agent) {
    return this.store.create(agent.scope, {
      name: `${agent.name} copy`,
      icon: agent.icon,
      emoji: agent.emoji,
      instructions: agent.instructions,
      harness: agent.harness,
      model: agent.model,
      tools: agent.tools,
      targets: agent.targets,
      output: agent.output,
      maxSteps: agent.maxSteps,
      enabled: agent.enabled,
    });
  }

  setEnabled(agent: Agent, enabled: boolean) {
    this.store.update(agent, { enabled });
  }
}

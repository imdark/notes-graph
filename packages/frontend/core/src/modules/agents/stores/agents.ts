import type { IconData } from '@notesgraph/component';
import { LiveData, Store } from '@notesgraph/infra';

import type { WorkspaceDBService } from '../../db';

/** Where an agent's row lives, which is also who can see it. */
export type AgentScope = 'workspace' | 'personal';

/** What an agent can be pointed at. */
export type AgentTargetKind = 'block' | 'selection' | 'doc';

/** What happens to an agent's result. Only `panel` is implemented. */
export type AgentOutput = 'panel';

/**
 * Which runtime executes an agent. `undefined` means "whatever the workspace's
 * AI backend is set to", which is how every agent behaved before this was
 * selectable.
 */
export type AgentHarness = 'on-device' | 'cloud';

export interface Agent {
  id: string;
  scope: AgentScope;
  name: string;
  /** Same IconData a note's icon uses, so agents share the note icon picker. */
  icon?: IconData;
  /** Legacy: rows written before `icon` stored a bare emoji. Read-only. */
  emoji?: string;
  instructions: string;
  harness?: AgentHarness;
  model?: string;
  tools: string[];
  targets: AgentTargetKind[];
  output: AgentOutput;
  maxSteps: number;
  enabled: boolean;
  createdAt: number;
  createdBy?: string;
}

export type AgentDraft = Omit<Agent, 'id' | 'scope' | 'createdAt'> &
  Partial<Pick<Agent, 'createdAt' | 'createdBy'>>;

export const DEFAULT_MAX_STEPS = 8;

/** A row as it comes off either table, before a scope is attached. */
interface AgentRowShape {
  id: string;
  name: string;
  icon?: IconData | null;
  emoji?: string | null;
  instructions: string;
  harness?: string | null;
  model?: string | null;
  tools: string[];
  targets: string[];
  output: string;
  maxSteps: number;
  enabled: boolean;
  createdAt: number;
  createdBy?: string | null;
}

const TARGET_KINDS: AgentTargetKind[] = ['block', 'selection', 'doc'];

/**
 * Reads and writes agents across the two tables that hold them: the workspace
 * DB (shared with collaborators) and this user's userdata DB (private, synced
 * to their own devices). The tables are the same shape, so the only difference
 * a caller sees is the `scope` tag attached on the way out — and moving an
 * agent between scopes is a row copy rather than a migration.
 *
 * See docs/reference/agents-on-blocks.md.
 */
export class AgentsStore extends Store {
  constructor(private readonly workspaceDBService: WorkspaceDBService) {
    super();
  }

  private get workspaceTable() {
    return this.workspaceDBService.db.agents;
  }

  private toAgent(row: AgentRowShape, scope: AgentScope): Agent {
    return {
      id: row.id,
      scope,
      name: row.name,
      icon: row.icon ?? undefined,
      emoji: row.emoji ?? undefined,
      instructions: row.instructions,
      harness:
        row.harness === 'on-device' || row.harness === 'cloud'
          ? row.harness
          : undefined,
      model: row.model ?? undefined,
      tools: row.tools ?? [],
      // Unknown values are dropped rather than trusted: these rows sync, and a
      // row written by a newer build (or edited by hand) shouldn't be able to
      // put an agent somewhere this build doesn't understand.
      targets: (row.targets ?? []).filter((t): t is AgentTargetKind =>
        TARGET_KINDS.includes(t as AgentTargetKind)
      ),
      output: 'panel',
      maxSteps: row.maxSteps ?? DEFAULT_MAX_STEPS,
      enabled: row.enabled ?? true,
      createdAt: row.createdAt ?? 0,
      createdBy: row.createdBy ?? undefined,
    };
  }

  private toRow(draft: AgentDraft) {
    return {
      name: draft.name,
      icon: draft.icon,
      emoji: draft.emoji,
      instructions: draft.instructions,
      harness: draft.harness,
      model: draft.model,
      tools: draft.tools,
      targets: draft.targets,
      output: draft.output,
      maxSteps: draft.maxSteps,
      enabled: draft.enabled,
      createdAt: draft.createdAt ?? Date.now(),
      createdBy: draft.createdBy,
    };
  }

  // --- reads -------------------------------------------------------------

  watchWorkspaceAgents(): LiveData<Agent[]> {
    return LiveData.from(this.workspaceTable.find$(), []).map(rows =>
      rows.map(row => this.toAgent(row as AgentRowShape, 'workspace'))
    );
  }

  watchPersonalAgents(): LiveData<Agent[]> {
    return this.workspaceDBService.userdataDB$
      .map(db => LiveData.from(db.agents.find$(), []))
      .flat()
      .map(rows => rows.map(row => this.toAgent(row as AgentRowShape, 'personal')));
  }

  // --- writes ------------------------------------------------------------

  create(scope: AgentScope, draft: AgentDraft): Agent {
    const row = this.toRow(draft);
    if (scope === 'workspace') {
      return this.toAgent(
        this.workspaceTable.create(row) as AgentRowShape,
        'workspace'
      );
    }
    const db = this.workspaceDBService.userdataDB$.value;
    return this.toAgent(db.agents.create(row) as AgentRowShape, 'personal');
  }

  update(agent: Agent, patch: Partial<AgentDraft>): void {
    if (agent.scope === 'workspace') {
      this.workspaceTable.update(agent.id, patch);
      return;
    }
    this.workspaceDBService.userdataDB$.value.agents.update(agent.id, patch);
  }

  delete(agent: Agent): void {
    if (agent.scope === 'workspace') {
      this.workspaceTable.delete(agent.id);
      return;
    }
    this.workspaceDBService.userdataDB$.value.agents.delete(agent.id);
  }

  /**
   * Copy an agent into the other scope and remove the original, keeping its
   * definition byte-identical. A new id is issued because the row is a new row
   * in a different table; anything holding the old id (a run record) keeps
   * pointing at the agent that ran, which is what a history should do.
   */
  move(agent: Agent, to: AgentScope): Agent {
    if (agent.scope === to) return agent;
    const moved = this.create(to, {
      name: agent.name,
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
      createdAt: agent.createdAt,
      createdBy: agent.createdBy,
    });
    this.delete(agent);
    return moved;
  }
}

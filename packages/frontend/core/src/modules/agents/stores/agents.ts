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
 *
 * `remote` runs the agent on a machine registered in the device registry:
 * the run is queued against a device and that device claims it. Nothing
 * here connects outward, so a machine behind NAT works the same as one on
 * the desk.
 *
 * `research` is `cloud` with OmniSeek's search and reading tools, which the
 * server reaches on the agent's behalf (see ResearchToolsService).
 */
export type AgentHarness = 'on-device' | 'cloud' | 'remote' | 'research';

/**
 * What a run of the agent is for, which decides how the app shows it.
 *
 * - `answer` replies to a question about the note. Nothing is written back,
 *   so the reply is the result: the run card shows it and offers to copy it.
 * - `worker` does work in the note — ticks off a task list, edits blocks,
 *   files what it learns. The note is the result; whatever it says at the end
 *   is a report on what it did, not something to copy.
 * - `fan-out` is a worker that splits itself: run on a block with sub-blocks
 *   under it, it starts one run per sub-block, side by side, each on its own
 *   item (see AgentRunSessionService.start). On a block with none it works
 *   that block like a worker.
 */
export type AgentKind = 'answer' | 'worker' | 'fan-out';

const AGENT_KINDS: AgentKind[] = ['answer', 'worker', 'fan-out'];

/**
 * An agent's kind, for rows saved before it was a setting: a Claude Code or
 * Workflow agent on a device (the server's runner, picked as Cloud, included)
 * works in the notes; anything else, research included, answers.
 */
export const agentKind = (agent: Pick<Agent, 'kind' | 'harness' | 'model'>) =>
  agent.kind ??
  ((agent.harness === 'remote' || agent.harness === 'cloud') &&
  (agent.model === 'claude-code' || agent.model === 'workflow')
    ? 'worker'
    : 'answer');

export interface Agent {
  id: string;
  scope: AgentScope;
  name: string;
  /** Same IconData a note's icon uses, so agents share the note icon picker. */
  icon?: IconData;
  /** Legacy: rows written before `icon` stored a bare emoji. Read-only. */
  emoji?: string;
  instructions: string;
  /** Unset on rows saved before it existed; read it through `agentKind`. */
  kind?: AgentKind;
  harness?: AgentHarness;
  model?: string;
  tools: string[];
  /** Skill names for a Claude agent; unset is the model's default set. */
  skills?: string[];
  targets: AgentTargetKind[];
  output: AgentOutput;
  maxSteps: number;
  /** For `remote` agents: the registry key of the device to run on. */
  deviceKey?: string;
  /** For device and cloud runs: the most one run may spend, in USD. */
  maxCostUsd?: number;
  /** For device and cloud runs: what a run may do without asking. Unset is `write`. */
  access?: AgentAccess;
  enabled: boolean;
  createdAt: number;
  createdBy?: string;
}

/**
 * What a device or cloud run may do without asking first. `read` refuses
 * anything but reading; `write` (the default) also writes notes; `manage`
 * also edits files; `full` is as if "Allow all" were pressed at the start.
 * Deploying, spending and deleting always ask, whatever the level.
 */
export type AgentAccess = 'read' | 'write' | 'manage' | 'full';

export const AGENT_ACCESS_LEVELS: AgentAccess[] = [
  'read',
  'write',
  'manage',
  'full',
];

const toAccess = (value: unknown): AgentAccess | undefined =>
  AGENT_ACCESS_LEVELS.includes(value as AgentAccess)
    ? (value as AgentAccess)
    : undefined;

const toCostCap = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;

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
  kind?: string | null;
  harness?: string | null;
  model?: string | null;
  tools: string[];
  skills?: string[] | null;
  targets: string[];
  output: string;
  maxSteps: number;
  deviceKey?: string | null;
  maxCostUsd?: number | null;
  access?: string | null;
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
      kind: AGENT_KINDS.includes(row.kind as AgentKind)
        ? (row.kind as AgentKind)
        : undefined,
      harness:
        row.harness === 'on-device' ||
        row.harness === 'cloud' ||
        row.harness === 'remote' ||
        row.harness === 'research'
          ? row.harness
          : undefined,
      model: row.model ?? undefined,
      tools: row.tools ?? [],
      skills: Array.isArray(row.skills) ? row.skills : undefined,
      // Unknown values are dropped rather than trusted: these rows sync, and a
      // row written by a newer build (or edited by hand) shouldn't be able to
      // put an agent somewhere this build doesn't understand.
      targets: (row.targets ?? []).filter((t): t is AgentTargetKind =>
        TARGET_KINDS.includes(t as AgentTargetKind)
      ),
      output: 'panel',
      maxSteps: row.maxSteps ?? DEFAULT_MAX_STEPS,
      deviceKey: row.deviceKey ?? undefined,
      maxCostUsd: toCostCap(row.maxCostUsd),
      access: toAccess(row.access),
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
      kind: draft.kind,
      harness: draft.harness,
      deviceKey: draft.deviceKey,
      model: draft.model,
      tools: draft.tools,
      skills: draft.skills,
      targets: draft.targets,
      output: draft.output,
      maxSteps: draft.maxSteps,
      maxCostUsd: draft.maxCostUsd,
      access: draft.access,
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
      kind: agent.kind,
      harness: agent.harness,
      deviceKey: agent.deviceKey,
      model: agent.model,
      tools: agent.tools,
      skills: agent.skills,
      targets: agent.targets,
      output: agent.output,
      maxSteps: agent.maxSteps,
      maxCostUsd: agent.maxCostUsd,
      access: agent.access,
      enabled: agent.enabled,
      createdAt: agent.createdAt,
      createdBy: agent.createdBy,
    });
    this.delete(agent);
    return moved;
  }
}

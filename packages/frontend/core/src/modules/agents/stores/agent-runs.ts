import { LiveData, Store } from '@notesgraph/infra';

import type { WorkspaceDBService } from '../../db';
import type { AgentTarget } from '../services/target';

export type AgentRunStatus = 'running' | 'done' | 'cancelled' | 'error';

export interface AgentRun {
  id: string;
  agentId: string;
  agentName: string;
  targetKind: string;
  docId: string;
  blockId?: string;
  status: AgentRunStatus;
  startedAt: number;
  durationMs?: number;
  steps?: number;
  summary?: string;
  error?: string;
}

/**
 * Newest runs to keep. Runs live in userdata, which syncs — an unbounded
 * history would grow that document forever for no benefit, since a run older
 * than the last few dozen has never once been the one anybody wanted.
 */
const MAX_RUNS = 60;

/** How much of a result to keep for the run list. */
const SUMMARY_CHARS = 200;

/**
 * Run history, in this user's userdata DB rather than the shared workspace one:
 * runs are per-person and high-volume, and a tool-call history in the shared
 * document would be synced by every collaborator forever.
 */
export class AgentRunsStore extends Store {
  constructor(private readonly workspaceDBService: WorkspaceDBService) {
    super();
  }

  private get table() {
    return this.workspaceDBService.userdataDB$.value.agentRuns;
  }

  watchRuns(): LiveData<AgentRun[]> {
    return this.workspaceDBService.userdataDB$
      .map(db => LiveData.from(db.agentRuns.find$(), []))
      .flat()
      .map(rows =>
        (rows as AgentRun[])
          .slice()
          .sort((a, b) => b.startedAt - a.startedAt)
      );
  }

  watchRunsForDoc(docId: string): LiveData<AgentRun[]> {
    return this.watchRuns().map(runs => runs.filter(run => run.docId === docId));
  }

  start(agent: { id: string; name: string }, target: AgentTarget): string {
    const row = this.table.create({
      agentId: agent.id,
      agentName: agent.name,
      targetKind: target.kind,
      docId: target.docId,
      blockId: target.kind === 'block' ? target.blockId : undefined,
      status: 'running',
      startedAt: Date.now(),
    });
    this.prune();
    return row.id;
  }

  finish(
    runId: string,
    outcome:
      | { status: 'done'; steps: number; output: string }
      | { status: 'cancelled'; steps: number }
      | { status: 'error'; steps: number; error: string }
  ): void {
    const row = this.table.get(runId);
    if (!row) return;
    this.table.update(runId, {
      status: outcome.status,
      durationMs: Date.now() - row.startedAt,
      steps: outcome.steps,
      summary:
        outcome.status === 'done'
          ? outcome.output.slice(0, SUMMARY_CHARS)
          : undefined,
      error: outcome.status === 'error' ? outcome.error : undefined,
    });
  }

  /** Drop the oldest rows beyond MAX_RUNS. */
  private prune(): void {
    const rows = this.table.find();
    if (rows.length <= MAX_RUNS) return;
    rows
      .slice()
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
      .slice(MAX_RUNS)
      .forEach(row => this.table.delete(row.id));
  }
}

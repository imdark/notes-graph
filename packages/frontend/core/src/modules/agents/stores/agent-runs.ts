import { LiveData, Store } from '@notesgraph/infra';

import type { WorkspaceDBService } from '../../db';
import type { AgentTarget } from '../services/target';
import type { AgentRunLogsStore } from './agent-run-logs';

export type AgentRunStatus = 'running' | 'done' | 'cancelled' | 'error';

export interface AgentRun {
  id: string;
  agentId: string;
  agentName: string;
  targetKind: string;
  docId: string;
  blockId?: string;
  blockIds?: string[];
  status: AgentRunStatus;
  startedAt: number;
  durationMs?: number;
  steps?: number;
  summary?: string;
  error?: string;
  /** The device job this run became, when it ran remotely. */
  remoteJobId?: string;
  deviceKey?: string;
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
  constructor(
    private readonly workspaceDBService: WorkspaceDBService,
    private readonly logsStore: AgentRunLogsStore
  ) {
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
      blockIds: target.kind === 'selection' ? target.blockIds : undefined,
      status: 'running',
      startedAt: Date.now(),
    });
    this.prune();
    return row.id;
  }

  watchRun(runId: string): LiveData<AgentRun | undefined> {
    return this.watchRuns().map(runs => runs.find(run => run.id === runId));
  }

  /** Record which device job a remote run became, so its log can be found. */
  attachRemote(runId: string, remoteJobId: string, deviceKey: string): void {
    if (!this.table.get(runId)) return;
    this.table.update(runId, { remoteJobId, deviceKey });
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

  /**
   * What the run was pointed at, to run it again. Null for a selection run
   * recorded before its blocks were kept.
   */
  targetOf(run: AgentRun): AgentTarget | null {
    switch (run.targetKind) {
      case 'block':
        return run.blockId
          ? { kind: 'block', docId: run.docId, blockId: run.blockId }
          : null;
      case 'selection':
        return run.blockIds?.length
          ? { kind: 'selection', docId: run.docId, blockIds: run.blockIds }
          : null;
      case 'doc':
        return { kind: 'doc', docId: run.docId };
      default:
        return null;
    }
  }

  /** Remove runs from the history, and their transcripts. */
  delete(runIds: string[]): void {
    runIds.forEach(id => this.table.delete(id));
    this.logsStore.delete(runIds).catch(() => {
      // A transcript left behind is harmless; it just isn't reachable.
    });
  }

  /** Drop the oldest rows beyond MAX_RUNS, and their transcripts. */
  private prune(): void {
    const rows = this.table.find();
    if (rows.length <= MAX_RUNS) return;
    const dropped = rows
      .slice()
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
      .slice(MAX_RUNS);
    this.delete(dropped.map(row => row.id));
  }
}

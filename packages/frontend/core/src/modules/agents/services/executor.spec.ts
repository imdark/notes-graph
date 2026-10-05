/**
 * @vitest-environment happy-dom
 */
import { Framework } from '@notesgraph/infra';
import { describe, expect, test } from 'vitest';

import { LocalLLMService } from '../../ai-local';
import { WorkspaceService } from '../../workspace';
import { AgentRunLogsStore } from '../stores/agent-run-logs';
import { type AgentRun, AgentRunsStore } from '../stores/agent-runs';
import { CloudAgentRunnerService } from './cloud-runner';
import { AgentContextService } from './context';
import { AgentExecutorService } from './executor';
import { AgentFileToolsService } from './file-tools';
import { RemoteAgentRunnerService, type RemoteJob } from './remote-runner';

const MINUTE = 60_000;

const row = (over: Partial<AgentRun>): AgentRun => ({
  id: 'r1',
  agentId: 'a1',
  agentName: 'Worker',
  targetKind: 'selection',
  docId: 'doc',
  status: 'running',
  startedAt: Date.now(),
  ...over,
});

const job = (over: Partial<RemoteJob>): RemoteJob => ({
  id: 'j1',
  deviceKey: 'box',
  status: 'running',
  result: null,
  error: null,
  steps: 3,
  tmuxSession: null,
  startedAt: null,
  finishedAt: null,
  ...over,
});

/** An executor over fake runs and jobs, recording what it settles. */
const setup = (runs: AgentRun[], jobs: Record<string, RemoteJob>) => {
  const finished: { runId: string; outcome: any; endedAt?: number }[] = [];
  const titles: { runId: string; title: string }[] = [];
  const runsStore = {
    runningRuns: () => runs.filter(run => run.status === 'running'),
    finish: (runId: string, outcome: any, endedAt?: number) =>
      finished.push({ runId, outcome, endedAt }),
    setTitle: (runId: string, title: string) => titles.push({ runId, title }),
  };
  const remoteRunner = {
    get: async (_workspaceId: string, jobId: string) => {
      const found = jobs[jobId];
      if (!found) throw new Error('unreachable');
      return found;
    },
  };
  const framework = new Framework();
  framework
    .service(AgentContextService, {} as any)
    .store(AgentRunsStore, runsStore as any)
    .store(AgentRunLogsStore, {} as any)
    .service(LocalLLMService, {} as any)
    .service(AgentFileToolsService, {} as any)
    .service(RemoteAgentRunnerService, remoteRunner as any)
    .service(CloudAgentRunnerService, {} as any)
    .service(WorkspaceService, { workspace: { id: 'ws' } } as any)
    .service(AgentExecutorService, [
      AgentContextService,
      AgentRunsStore,
      AgentRunLogsStore,
      LocalLLMService,
      AgentFileToolsService,
      RemoteAgentRunnerService,
      CloudAgentRunnerService,
      WorkspaceService,
    ]);
  const executor = framework.provider().get(AgentExecutorService);
  return { executor, finished, titles };
};

describe('AgentExecutorService.reconcileRuns', () => {
  test('a device run whose job finished takes the job’s end', async () => {
    const startedAt = Date.now() - 5 * MINUTE;
    const { executor, finished } = setup(
      [row({ startedAt, remoteJobId: 'j1' })],
      {
        j1: job({
          status: 'done',
          result: 'All done',
          finishedAt: (startedAt + 2 * MINUTE) / 1000,
        }),
      }
    );
    await executor.reconcileRuns();
    expect(finished).toEqual([
      {
        runId: 'r1',
        outcome: { status: 'done', steps: 3, output: 'All done' },
        endedAt: startedAt + 2 * MINUTE,
      },
    ]);
  });

  test('a device run takes the title its agent gave it', async () => {
    const { executor, titles } = setup([row({ remoteJobId: 'j1' })], {
      j1: job({ status: 'done', title: 'Pick a show for Cosmo' }),
    });
    await executor.reconcileRuns();
    expect(titles).toEqual([{ runId: 'r1', title: 'Pick a show for Cosmo' }]);
  });

  test('a device run still going, or unreachable, is left alone', async () => {
    const { executor, finished } = setup(
      [
        row({ id: 'r1', remoteJobId: 'j1' }),
        row({ id: 'r2', remoteJobId: 'gone' }),
      ],
      { j1: job({ status: 'running' }) }
    );
    await executor.reconcileRuns();
    expect(finished).toEqual([]);
  });

  test('a failed device job settles as an error', async () => {
    const { executor, finished } = setup(
      [row({ remoteJobId: 'j1' })],
      { j1: job({ status: 'error', error: 'boom', finishedAt: 1 }) }
    );
    await executor.reconcileRuns();
    expect(finished[0].outcome).toEqual({
      status: 'error',
      steps: 3,
      error: 'boom',
    });
  });

  test('an in-tab run past every wall clock is recorded as interrupted', async () => {
    const { executor, finished } = setup(
      [
        row({ id: 'old', startedAt: Date.now() - 60 * MINUTE }),
        row({ id: 'recent', startedAt: Date.now() - MINUTE }),
      ],
      {}
    );
    await executor.reconcileRuns();
    expect(finished.map(f => f.runId)).toEqual(['old']);
    expect(finished[0].outcome.status).toBe('error');
    expect(finished[0].outcome.error).toMatch(/Interrupted/);
  });
});

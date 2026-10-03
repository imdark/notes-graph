import { Service } from '@notesgraph/infra';

import { FetchService, type WorkspaceServerService } from '../../cloud';

/**
 * Runs an agent on a registered device instead of in this browser.
 *
 * The job is queued against the device inventory and the device claims it;
 * nothing here connects to the machine. That direction matters: a device in
 * the field sits behind NAT, and having it initiate every connection means
 * the server never needs a route in, and no credential for it lives here.
 */

export interface RemoteJob {
  id: string;
  deviceKey: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  result: string | null;
  error: string | null;
  steps: number;
  /** tmux session on the device; `tmux attach -t` it there to watch. */
  tmuxSession: string | null;
  /** Transcript from absolute offset `logFrom` to `logEnd`. */
  log?: string;
  logFrom?: number;
  logEnd?: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/** One step of {@link RemoteAgentRunnerService.watch}. */
export interface RemoteJobUpdate {
  job: RemoteJob;
  /** Transcript text that is new since the previous update. */
  logDelta: string;
}

export interface EnqueueRemoteJob {
  deviceKey: string;
  agentId: string;
  agentName: string;
  instructions: string;
  context: string;
  model?: string;
  tools?: string[];
  maxSteps?: number;
  targetKind?: string;
  docId?: string;
  blockId?: string;
}

/** How often to ask the server whether a remote run has moved on. */
const POLL_MS = 1500;

export class RemoteAgentRunnerService extends Service {
  constructor(
    private readonly workspaceServerService: WorkspaceServerService
  ) {
    super();
  }

  /**
   * FetchService lives in the server scope, not the workspace scope this
   * service is registered in, so it has to be reached through the
   * workspace's server rather than injected. Taking it as a constructor
   * dependency compiles fine and then throws
   * "Missing dependency [FetchService]" the first time anything resolves
   * this service - which is at render, so the settings pane crashes.
   *
   * Null for a local workspace: there is no server to run anything on.
   */
  private get fetchService(): FetchService | undefined {
    return this.workspaceServerService.server?.scope.get(FetchService);
  }

  private base(workspaceId: string) {
    return `/api/inventory/workspaces/${encodeURIComponent(workspaceId)}`;
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    const fetchService = this.fetchService;
    if (!fetchService) {
      throw new Error(
        'This workspace is local, so there is no server to run an agent on.'
      );
    }
    const response = await fetchService.fetch(url, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      // The server's message is the useful part -- "not an agent target",
      // "no such device" -- so surface it rather than a bare status code.
      let detail = `${response.status}`;
      try {
        const body = (await response.json()) as { message?: string };
        if (body?.message) detail = body.message;
      } catch {
        // non-JSON error body; the status is all we have
      }
      throw new Error(detail);
    }
    // An API path the server doesn't have falls through to the SPA, which
    // answers 200 with index.html. Catch that here so it reads as "not
    // deployed" rather than as a JSON parse error.
    const text = await response.text();
    if (text.trimStart().startsWith('<')) {
      throw new Error(
        'The agent jobs API is not available on this server yet.'
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Unexpected response from ${url}`);
    }
  }

  /** List the devices in this workspace that accept agent work. */
  async agentTargets(workspaceId: string) {
    const data = await this.json<{
      devices: { key: string; name: string; state: string; kind: string }[];
    }>(`${this.base(workspaceId)}/devices?agentTarget=true`);
    return data.devices;
  }

  async enqueue(workspaceId: string, input: EnqueueRemoteJob): Promise<RemoteJob> {
    const { deviceKey, ...body } = input;
    const data = await this.json<{ job: RemoteJob }>(
      `${this.base(workspaceId)}/devices/${encodeURIComponent(deviceKey)}/jobs`,
      { method: 'POST', body: JSON.stringify(body) }
    );
    return data.job;
  }

  async get(
    workspaceId: string,
    jobId: string,
    logFrom = 0
  ): Promise<RemoteJob> {
    const data = await this.json<{ job: RemoteJob }>(
      `${this.base(workspaceId)}/jobs/${encodeURIComponent(jobId)}?logFrom=${logFrom}`
    );
    return data.job;
  }

  async cancel(workspaceId: string, jobId: string): Promise<void> {
    await this.json(`${this.base(workspaceId)}/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
    });
  }

  /**
   * Poll a job to completion, yielding whenever its status changes or its
   * transcript grows. Only the new part of the transcript is fetched each
   * time.
   *
   * With `cancelOnAbort` (the default — the tab that started the run), an
   * abort cancels the job server-side before returning: leaving a device
   * working on a run whose tab has closed is the one failure mode that costs
   * someone else's hardware. Someone merely viewing a run's log passes
   * false, so closing the log does not stop the run.
   */
  async *watch(
    workspaceId: string,
    jobId: string,
    signal: AbortSignal,
    { cancelOnAbort = true }: { cancelOnAbort?: boolean } = {}
  ): AsyncIterable<RemoteJobUpdate> {
    let lastStatus = '';
    let logFrom = 0;
    try {
      while (!signal.aborted) {
        const job = await this.get(workspaceId, jobId, logFrom);
        const logDelta = job.log ?? '';
        logFrom = job.logEnd ?? logFrom;
        if (job.status !== lastStatus || logDelta) {
          lastStatus = job.status;
          yield { job, logDelta };
        }
        if (['done', 'error', 'cancelled'].includes(job.status)) {
          return;
        }
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
      }
    } finally {
      if (signal.aborted && cancelOnAbort) {
        await this.cancel(workspaceId, jobId).catch(() => {
          // Best effort: the lease expires on its own if this never lands.
        });
      }
    }
  }
}

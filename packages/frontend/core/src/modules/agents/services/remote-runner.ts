import { Service } from '@notesgraph/infra';

import type { FetchService } from '../../cloud';

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
  constructor(private readonly fetchService: FetchService) {
    super();
  }

  private base(workspaceId: string) {
    return `/api/inventory/workspaces/${encodeURIComponent(workspaceId)}`;
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchService.fetch(url, {
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

  async get(workspaceId: string, jobId: string): Promise<RemoteJob> {
    const data = await this.json<{ job: RemoteJob }>(
      `${this.base(workspaceId)}/jobs/${encodeURIComponent(jobId)}`
    );
    return data.job;
  }

  async cancel(workspaceId: string, jobId: string): Promise<void> {
    await this.json(`${this.base(workspaceId)}/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
    });
  }

  /**
   * Poll a job to completion, yielding each status change.
   *
   * On abort the job is cancelled server-side before returning: leaving a
   * device working on a run whose tab has closed is the one failure mode
   * that costs someone else's hardware.
   */
  async *watch(
    workspaceId: string,
    jobId: string,
    signal: AbortSignal
  ): AsyncIterable<RemoteJob> {
    let last = '';
    try {
      while (!signal.aborted) {
        const job = await this.get(workspaceId, jobId);
        if (job.status !== last) {
          last = job.status;
          yield job;
        }
        if (['done', 'error', 'cancelled'].includes(job.status)) {
          return;
        }
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
      }
    } finally {
      if (signal.aborted) {
        await this.cancel(workspaceId, jobId).catch(() => {
          // Best effort: the lease expires on its own if this never lands.
        });
      }
    }
  }
}

/**
 * Claim and run jobs until stopped: the cloud twin of `wf agent serve`
 * (workflow/deploy/jobs.py serve, _Reporter, _run_claimed).
 */
import type { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import { type Job, type NotesGraphApi, NotesGraphError } from './api';
import { type RunnerSettings, runJob } from './run-job';
import { JobCancelled } from './run-tools';

export const LEASE_SECONDS = 300;
const HEARTBEAT_MS = 60_000;

export interface ServeOptions {
  api: NotesGraphApi;
  workspaces: string[];
  deviceKey: string;
  runnerId: string;
  settings: RunnerSettings;
  query: typeof sdkQuery;
  maxJobs?: number;
  pollMs?: number;
  /** How often a running job's new transcript is sent. */
  tickMs?: number;
  log?: (line: string) => void;
  signal?: AbortSignal;
}

/**
 * Ships a running job's transcript and renews its lease. Text goes out as it
 * arrives; with none, a bare report still goes every minute so a long quiet
 * run isn't re-claimed. One report at a time, so they can't arrive out of
 * order. Cancels the run when the server says the job was stopped.
 */
class Reporter {
  private pending = '';
  private last = 0;
  private sending: Promise<void> = Promise.resolve();

  constructor(
    private readonly api: NotesGraphApi,
    private readonly workspaceId: string,
    private readonly jobId: string,
    private readonly cancel: () => void
  ) {}

  append(text: string) {
    this.pending += text;
  }

  tick() {
    this.sending = this.sending.then(() => this.send());
    return this.sending;
  }

  private async send() {
    if (!this.pending && Date.now() - this.last < HEARTBEAT_MS) return;
    const logAppend = this.pending;
    try {
      const job = await this.api.report(this.workspaceId, this.jobId, {
        status: 'running',
        leaseSeconds: LEASE_SECONDS,
        ...(logAppend ? { logAppend } : {}),
      });
      this.pending = this.pending.slice(logAppend.length);
      this.last = Date.now();
      if (job?.status === 'cancelled') this.cancel();
    } catch (err) {
      // Keep the text for the next tick. A lost heartbeat is survivable: the
      // lease lapses and the job can be claimed again.
      if (!(err instanceof NotesGraphError)) throw err;
    }
  }

  /** The text not yet sent, handed over with the final report. */
  async drain(): Promise<string> {
    await this.sending;
    const rest = this.pending;
    this.pending = '';
    return rest;
  }
}

/** Run a claimed job and report how it ended. */
export async function runClaimed(
  opts: ServeOptions,
  workspaceId: string,
  job: Job
): Promise<'done' | 'error' | 'cancelled'> {
  const { api } = opts;
  const stop = new AbortController();
  opts.signal?.addEventListener('abort', () => stop.abort());
  const reporter = new Reporter(api, workspaceId, job.id, () => stop.abort());
  const ticker = setInterval(() => void reporter.tick(), opts.tickMs ?? 2000);
  try {
    const outcome = await runJob(job, {
      api,
      workspaceId,
      settings: opts.settings,
      query: opts.query,
      say: line => reporter.append(line.endsWith('\n') ? line : `${line}\n`),
      signal: stop.signal,
    });
    clearInterval(ticker);
    const logAppend = await reporter.drain();
    await api.report(workspaceId, job.id, {
      status: 'done',
      result: outcome.result,
      steps: outcome.steps,
      ...(logAppend ? { logAppend } : {}),
    });
    return 'done';
  } catch (err) {
    clearInterval(ticker);
    const logAppend = await reporter.drain();
    if (stop.signal.aborted || err instanceof JobCancelled) {
      // Stopped from NotesGraph: the server already has it as cancelled.
      if (logAppend) {
        await api.report(workspaceId, job.id, { logAppend }).catch(() => {});
      }
      return 'cancelled';
    }
    await api
      .report(workspaceId, job.id, {
        status: 'error',
        error: String(err instanceof Error ? err.message : err).slice(0, 2000),
        ...(logAppend ? { logAppend } : {}),
      })
      .catch(() => {});
    return 'error';
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Up to `maxJobs` at once across the workspaces; with every slot taken
 * nothing more is claimed, so the rest stay queued. Resolves once `signal`
 * aborts and the running jobs have ended.
 */
export async function serve(opts: ServeOptions): Promise<void> {
  const log = opts.log ?? (() => {});
  const maxJobs = Math.max(1, opts.maxJobs ?? 2);
  const running = new Set<Promise<unknown>>();

  while (!opts.signal?.aborted) {
    let claimed = false;
    for (const workspaceId of opts.workspaces) {
      if (running.size >= maxJobs || opts.signal?.aborted) break;
      let job: Job | null;
      try {
        job = await opts.api.claim(workspaceId, opts.deviceKey, opts.runnerId, LEASE_SECONDS);
      } catch (err) {
        log(`claim failed: ${err}`);
        await sleep(Math.min((opts.pollMs ?? 5000) * 4, 60_000), opts.signal);
        continue;
      }
      if (!job) continue;
      claimed = true;
      log(`claimed ${job.id} (${job.model ?? 'plain'}) in ${workspaceId}`);
      const work = runClaimed(opts, workspaceId, job).then(
        end => log(`${end} ${job.id}`),
        err => log(`failed ${job.id}: ${err}`)
      );
      running.add(work);
      void work.finally(() => running.delete(work));
    }
    if (running.size >= maxJobs) {
      await Promise.race(running);
    } else if (!claimed) {
      await sleep(opts.pollMs ?? 5000, opts.signal);
    }
  }
  await Promise.allSettled(running);
}

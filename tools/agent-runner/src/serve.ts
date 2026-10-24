/**
 * Claim and run jobs until stopped: the cloud twin of `wf agent serve`
 * (workflow/deploy/jobs.py serve, _Reporter, _run_claimed).
 */
import type { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import {
  type Job,
  type JobKind,
  type NotesGraphApi,
  NotesGraphError,
} from './api';
import { CodeCancelled, CodeFailed, runCode } from './code-runner';
import { RunFailed, runJob, type RunnerSettings } from './run-job';
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
  /** Also take automation jobs (run code); on unless set false. */
  automations?: boolean;
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

/**
 * Run an automation's code and report how it ended: its return value (JSON)
 * as the result, its console as the log. "Timed out" leads the error of a
 * run that hit its limit; the server reads it as timed_out.
 */
async function runAutomation(
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
    if (!job.payload?.code) throw new CodeFailed('The job carries no code');
    const output = await runCode(
      {
        code: job.payload.code,
        input: job.payload.input,
        secrets: job.secrets ?? {},
        timeoutSeconds: job.payload.timeoutSeconds,
      },
      { say: line => reporter.append(`${line}\n`), signal: stop.signal }
    );
    clearInterval(ticker);
    const logAppend = await reporter.drain();
    await api.report(workspaceId, job.id, {
      status: 'done',
      result: output ?? '',
      ...(logAppend ? { logAppend } : {}),
    });
    return 'done';
  } catch (err) {
    clearInterval(ticker);
    const logAppend = await reporter.drain();
    if (err instanceof CodeCancelled) {
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

/** Run a claimed job and report how it ended. */
export async function runClaimed(
  opts: ServeOptions,
  workspaceId: string,
  job: Job
): Promise<'done' | 'error' | 'cancelled'> {
  if (job.kind === 'automation') return runAutomation(opts, workspaceId, job);
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
      ...(outcome.costUsd === undefined ? {} : { costUsd: outcome.costUsd }),
      ...(outcome.tokens === undefined ? {} : { tokens: outcome.tokens }),
      ...(outcome.changes ? { changes: outcome.changes } : {}),
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
        ...(err instanceof RunFailed ? err.usage : {}),
        ...(err instanceof RunFailed && err.changes
          ? { changes: err.changes }
          : {}),
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
 * Up to `maxJobs` at once across the workspaces, or what the device is set
 * to run at once in the app ("jobs at once") when it is; with every slot
 * taken nothing more is claimed, so the rest stay queued. Resolves once
 * `signal` aborts and the running jobs have ended.
 */
export async function serve(opts: ServeOptions): Promise<void> {
  const log = opts.log ?? (() => {});
  const ownMax = Math.max(1, opts.maxJobs ?? 2);
  // What each workspace set this device to run at once in the app, from its
  // last claim; unset ones leave it to `ownMax`. The server also refuses a
  // claim past its own workspace's setting, so this only decides how many
  // this runner tries for.
  const setInApp = new Map<string, number | null>();
  const maxJobs = () => {
    const set = [...setInApp.values()].filter((n): n is number => n !== null);
    return set.length ? Math.max(...set) : ownMax;
  };
  const setLimit = (workspaceId: string, limit: number | null) => {
    if (setInApp.has(workspaceId) && setInApp.get(workspaceId) === limit)
      return;
    setInApp.set(workspaceId, limit);
    log(
      limit === null
        ? `${workspaceId}: jobs at once is this runner's own (${ownMax})`
        : `${workspaceId}: jobs at once set to ${limit} in the app`
    );
  };
  const running = new Set<Promise<unknown>>();
  // Workspaces where this runner's token may not take automation jobs (the
  // claim reveals secrets, so it needs workspace settings access): they get
  // agent jobs only, rather than no jobs at all.
  const agentOnly = new Set<string>();
  const claim = async (workspaceId: string) => {
    const kinds: JobKind[] =
      opts.automations === false || agentOnly.has(workspaceId)
        ? ['agent']
        : ['agent', 'automation'];
    try {
      return await opts.api.claim(
        workspaceId,
        opts.deviceKey,
        opts.runnerId,
        LEASE_SECONDS,
        kinds
      );
    } catch (err) {
      if (
        kinds.includes('automation') &&
        err instanceof NotesGraphError &&
        err.status === 403
      ) {
        agentOnly.add(workspaceId);
        log(
          `${workspaceId}: this token may not run automations; taking agent jobs only`
        );
        return await opts.api.claim(
          workspaceId,
          opts.deviceKey,
          opts.runnerId,
          LEASE_SECONDS,
          ['agent']
        );
      }
      throw err;
    }
  };

  while (!opts.signal?.aborted) {
    let claimed = false;
    for (const workspaceId of opts.workspaces) {
      if (running.size >= maxJobs() || opts.signal?.aborted) break;
      let job: Job | null;
      try {
        const claimed = await claim(workspaceId);
        setLimit(workspaceId, claimed.maxJobs);
        job = claimed.job;
      } catch (err) {
        log(`claim failed: ${err}`);
        await sleep(Math.min((opts.pollMs ?? 5000) * 4, 60_000), opts.signal);
        continue;
      }
      if (!job) continue;
      claimed = true;
      log(
        `claimed ${job.id} (${job.kind === 'automation' ? 'automation' : (job.model ?? 'plain')}) in ${workspaceId}`
      );
      const work = runClaimed(opts, workspaceId, job).then(
        end => log(`${end} ${job.id}`),
        err => log(`failed ${job.id}: ${err}`)
      );
      running.add(work);
      work
        .finally(() => running.delete(work))
        .catch(err => log(`failed ${job.id}: ${err}`));
    }
    if (running.size >= maxJobs()) {
      // Wait for a slot to free up, and meanwhile notice, without claiming,
      // that the device was given more in the app.
      await Promise.race([...running, sleep(opts.pollMs ?? 5000, opts.signal)]);
      for (const workspaceId of opts.workspaces) {
        if (running.size < maxJobs() || opts.signal?.aborted) break;
        try {
          setLimit(
            workspaceId,
            await opts.api.maxJobs(workspaceId, opts.deviceKey)
          );
        } catch (err) {
          log(`reading jobs at once failed: ${err}`);
        }
      }
    } else if (!claimed) {
      await sleep(opts.pollMs ?? 5000, opts.signal);
    }
  }
  await Promise.allSettled(running);
}

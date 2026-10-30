import {
  Injectable,
  Logger,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  type Automation,
  type AutomationRun,
  Prisma,
  type RegistryJob,
} from '@prisma/client';

import { BadRequest, NotFound, OnEvent } from '../../base';
import { Models, RUN_LOG_CAP } from '../../models';
import { type GateQuery, JobGates, RegistryJobService } from '../registry';
import { endActions, hookJob, prestartVerdict } from './hooks';
import {
  type AgentHook,
  type AutomationEvent,
  type EventFilter,
  hooksRun,
  matchingTrigger,
  nextRunAt,
  type Trigger,
} from './triggers';

/** What started a run, as kept on the run. */
export interface RunTrigger {
  type: Trigger['type'];
  event?: AutomationEvent;
  hook?: AgentHook;
  /** Who clicked Run, for a manual run. */
  by?: string;
}

/** A doc.updated trigger fires at most once in this long, per automation. */
export const DOC_UPDATED_DEBOUNCE_MS = 60_000;
/** Longest a run may be given. */
export const MAX_TIMEOUT_SECONDS = 15 * 60;
/** Longest a shell automation's run may be given: long enough for a deploy. */
export const MAX_SHELL_TIMEOUT_SECONDS = 60 * 60;

/**
 * How an automation's code runs on its device. 'node': JavaScript. 'shell':
 * JavaScript given `sh` too, to run commands there. 'actions': YAML in wf's
 * own action language (custom_command, cloud_deploy, notification...). The
 * last two run on wf devices only; the cloud runner refuses them.
 */
export const AUTOMATION_RUNTIMES = ['node', 'shell', 'actions'] as const;
export type AutomationRuntime = (typeof AUTOMATION_RUNTIMES)[number];

/** Whether its code runs commands on the device, which wf alone allows. */
export const runsCommands = (runtime: string) =>
  runtime === 'shell' || runtime === 'actions';

export const maxTimeoutSeconds = (runtime: string) =>
  runsCommands(runtime) ? MAX_SHELL_TIMEOUT_SECONDS : MAX_TIMEOUT_SECONDS;
/** Most input a run carries (a webhook body, an event). */
export const MAX_INPUT_BYTES = 256 * 1024;

const JOB_TO_RUN_STATUS: Record<string, string> = {
  done: 'succeeded',
  error: 'failed',
  cancelled: 'cancelled',
};

/**
 * Starts automations and keeps their runs current.
 *
 * A run is a registry job of kind 'automation' on the target device: this
 * queues it, the device's runner executes the code, and its report comes
 * back as `registry.job.finished`.
 */
@Injectable()
export class AutomationService implements OnModuleInit {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly models: Models,
    private readonly jobs: RegistryJobService,
    @Optional() private readonly gates?: JobGates
  ) {}

  /** Prestart hooks hold agent jobs until they pass; see hooks.ts. */
  onModuleInit() {
    this.gates?.register({
      holds: query => this.prestartHolds(query),
      start: job => this.startPrestart(job),
    });
  }

  async getOwned(workspaceId: string, id: string) {
    const automation = await this.models.automation.get(workspaceId, id);
    if (!automation) throw new NotFound('Automation not found');
    return automation;
  }

  /**
   * Queue a run of the version deployed to `target` (or to the automation's
   * first target). Throws when there is nothing deployed to run.
   */
  async start(
    automation: Automation,
    trigger: RunTrigger,
    input: unknown = null,
    {
      target,
      attempt = 1,
      hook,
      hookJobId,
    }: {
      target?: string;
      attempt?: number;
      /** For a hook run: which hook, and the agent job it wraps. */
      hook?: AgentHook;
      hookJobId?: string;
    } = {}
  ): Promise<AutomationRun> {
    const deployments = await this.models.automation.listDeployments(
      automation.id
    );
    const deployment = target
      ? deployments.find(d => d.target === target)
      : deployments[0];
    if (!deployment) {
      throw new BadRequest(
        target
          ? `"${automation.name}" isn't deployed to ${target}`
          : `"${automation.name}" isn't deployed anywhere yet`
      );
    }
    const version = await this.models.automation.getVersion(
      automation.id,
      deployment.versionId
    );
    if (!version) throw new NotFound('Deployed version not found');

    const run = await this.models.automation.createRun({
      automationId: automation.id,
      versionId: version.id,
      target: deployment.target,
      trigger: trigger as unknown as Prisma.InputJsonValue,
      input: capInput(input),
      attempt,
      hook,
      hookJobId,
    });
    try {
      const job = await this.jobs.enqueueAutomation(
        automation.workspaceId,
        automation.createdBy,
        deployment.target,
        automation,
        {
          automationId: automation.id,
          runId: run.id,
          versionId: version.id,
          code: version.code,
          input: capInput(input),
          timeoutSeconds: Math.min(
            automation.timeoutSeconds,
            maxTimeoutSeconds(automation.runtime)
          ),
          secrets: automation.secrets,
          runtime: automation.runtime,
          // What a runner from before `runtime` reads; it runs no YAML.
          shell: runsCommands(automation.runtime),
        }
      );
      await this.models.automation.update(automation.id, {
        lastRunAt: new Date(),
      });
      return await this.models.automation.updateRun(run.id, { jobId: job.id });
    } catch (err) {
      // The run exists but never reached a runner: say why on the run.
      await this.models.automation.updateRun(run.id, {
        status: 'failed',
        error: (err as Error).message,
        finishedAt: new Date(),
      });
      throw err;
    }
  }

  /** The cron's tick: book the next run first, then start this one. */
  async runScheduled(automation: Automation, now = new Date()) {
    const triggers = automation.triggers as unknown as Trigger[];
    await this.models.automation.update(automation.id, {
      nextRunAt: nextRunAt(triggers, now),
    });
    const scheduled = triggers.find(
      t => t.type === 'cron' || t.type === 'interval'
    );
    await this.start(automation, { type: scheduled?.type ?? 'cron' });
  }

  @OnEvent('registry.job.started')
  async onJobStarted(event: Events['registry.job.started']) {
    if (event.kind === 'automation') {
      const run = await this.models.automation.findRunByJob(event.jobId);
      if (run && run.status === 'queued') {
        await this.models.automation.updateRun(run.id, {
          status: 'running',
          startedAt: new Date(),
        });
      }
      return;
    }
    await this.dispatch(event.workspaceId, 'run.started', event, {
      agentId: event.agentId,
      deviceKey: event.deviceKey,
    });
  }

  @OnEvent('registry.job.finished')
  async onJobFinished(event: Events['registry.job.finished']) {
    if (event.kind === 'automation') {
      await this.finishRun(event);
      return;
    }
    const fields = {
      agentId: event.agentId,
      deviceKey: event.deviceKey,
      status: event.status,
    };
    await this.startEndHooks(event).catch(err => {
      this.logger.warn(`end hooks for job ${event.jobId}: ${err}`);
    });
    await this.dispatch(event.workspaceId, 'job.finished', event, fields);
    if (event.status === 'error') {
      await this.dispatch(event.workspaceId, 'run.failed', event, fields);
    }
  }

  @OnEvent('monitor.reading')
  async onMonitorReading(event: Events['monitor.reading']) {
    await this.dispatch(event.workspaceId, 'monitor.reading', event, {
      monitorId: event.monitorId,
    });
  }

  @OnEvent('doc.updated')
  async onDocUpdated(event: Events['doc.updated']) {
    await this.dispatch(event.workspaceId, 'doc.updated', event, {
      docId: event.docId,
    });
  }

  /** Start every automation in the workspace this event triggers. */
  private async dispatch(
    workspaceId: string,
    event: AutomationEvent,
    payload: unknown,
    fields: EventFilter
  ) {
    try {
      const automations =
        await this.models.automation.listWithEventTriggers(workspaceId);
      const now = Date.now();
      for (const automation of automations) {
        const triggers = automation.triggers as unknown as Trigger[];
        if (!matchingTrigger(triggers, event, fields)) continue;
        if (
          event === 'doc.updated' &&
          automation.lastRunAt &&
          now - automation.lastRunAt.getTime() < DOC_UPDATED_DEBOUNCE_MS
        ) {
          continue;
        }
        await this.start(
          automation,
          { type: 'event', event },
          { event, ...(payload as object) }
        ).catch(err => {
          this.logger.warn(
            `automation ${automation.id} on ${event}: ${(err as Error).message}`
          );
        });
      }
    } catch (err) {
      this.logger.warn(`dispatching ${event} failed: ${err}`);
    }
  }

  /**
   * Copy a finished job onto its run, and retry a failure if allowed. A
   * hook run's last attempt then acts on the agent run it wraps.
   */
  private async finishRun(event: Events['registry.job.finished']) {
    const run = await this.models.automation.findRunByJob(event.jobId);
    if (!run) return;
    const job = await this.models.registryJob.get(
      event.workspaceId,
      event.jobId
    );
    const status = runStatus(event.status, event.error);
    const finished = await this.models.automation.updateRun(run.id, {
      status,
      output: parseOutput(event.result),
      error: event.error,
      logs: (job?.log ?? '').slice(-RUN_LOG_CAP),
      startedAt: run.startedAt ?? job?.startedAt ?? null,
      finishedAt: new Date(),
    });

    let retried = false;
    if (status === 'failed' || status === 'timed_out') {
      const automation = await this.models.automation.get(
        event.workspaceId,
        run.automationId
      );
      if (automation?.enabled && run.attempt <= automation.maxRetries) {
        retried = true;
        await this.start(
          automation,
          run.trigger as unknown as RunTrigger,
          run.input,
          {
            target: run.target,
            attempt: run.attempt + 1,
            hook: (run.hook as AgentHook | null) ?? undefined,
            hookJobId: run.hookJobId ?? undefined,
          }
        ).catch(err => {
          this.logger.warn(
            `retrying automation ${automation.id}: ${(err as Error).message}`
          );
        });
      }
    }

    if (run.hookJobId && run.hook === 'prestart') {
      await this.resolvePrestart(event.workspaceId, run.hookJobId);
    } else if (run.hookJobId && run.hook === 'end' && !retried) {
      await this.applyEnd(event.workspaceId, finished);
    }
  }

  /** Whether a new agent job must wait on a prestart hook. */
  private async prestartHolds(query: GateQuery): Promise<boolean> {
    return (
      (await this.hooksFor(query.workspaceId, 'prestart', query)).length > 0
    );
  }

  private async hooksFor(
    workspaceId: string,
    hook: AgentHook,
    fields: { agentId: string; deviceKey: string }
  ) {
    // A device's health check is the runner's own, not an agent's run: no
    // workspace hook may hold it up or fail it.
    if (fields.agentId.startsWith('health:')) return [];
    const automations = await this.models.automation.listWithHooks(workspaceId);
    return automations.filter(a =>
      hooksRun(a.triggers as unknown as Trigger[], hook, fields)
    );
  }

  /** Start every prestart hook a held job waits on. */
  private async startPrestart(job: RegistryJob) {
    const hooks = await this.hooksFor(job.workspaceId, 'prestart', job);
    // While they are being started, one that ends early mustn't let the job
    // go before the rest exist.
    this.startingPrestart.add(job.id);
    try {
      // One at a time: a hook that can't start fails the job, and the ones
      // after it needn't run.
      for (const automation of hooks) {
        await this.start(
          automation,
          { type: 'hook', hook: 'prestart' },
          { hook: 'prestart', job: hookJob(job) },
          { hook: 'prestart', hookJobId: job.id }
        );
      }
    } finally {
      this.startingPrestart.delete(job.id);
    }
    await this.resolvePrestart(job.workspaceId, job.id);
  }

  /** Held jobs whose prestart hooks are still being started. */
  private readonly startingPrestart = new Set<string>();

  /**
   * Once every prestart hook of a held job is through (its last attempt
   * ended), let the job go to the queue with what they rewrote, or fail it
   * with why. Called as each one ends; until the last, it waits.
   */
  async resolvePrestart(workspaceId: string, jobId: string) {
    if (this.startingPrestart.has(jobId)) return;
    const runs = await this.models.automation.listHookRuns(jobId, 'prestart');
    const latest = new Map<string, (typeof runs)[number]>();
    for (const run of runs) {
      const seen = latest.get(run.automationId);
      if (!seen || run.attempt >= seen.attempt)
        latest.set(run.automationId, run);
    }
    const last = [...latest.values()];
    if (!last.length) return;
    if (last.some(r => r.status === 'queued' || r.status === 'running')) return;

    const changes: { instructions?: string; context?: string } = {};
    for (const run of last) {
      const name = run.automation.name;
      if (run.status !== 'succeeded') {
        await this.jobs.failHeld(
          workspaceId,
          jobId,
          `Prestart automation "${name}" ${run.status.replace('_', ' ')}` +
            (run.error ? `: ${run.error}` : '')
        );
        return;
      }
      const verdict = prestartVerdict(run.output);
      if (!verdict.allow) {
        await this.jobs.failHeld(
          workspaceId,
          jobId,
          `Stopped by automation "${name}": ${verdict.reason}`
        );
        return;
      }
      if (verdict.instructions !== undefined) {
        changes.instructions = verdict.instructions;
      }
      if (verdict.context !== undefined) changes.context = verdict.context;
    }
    const rewrote = Object.keys(changes);
    await this.jobs.releaseHeld(
      workspaceId,
      jobId,
      changes,
      `✓ Prestart automations passed: ${last.map(r => `"${r.automation.name}"`).join(', ')}` +
        (rewrote.length ? ` (rewrote ${rewrote.join(' and ')})` : '') +
        '\n'
    );
  }

  /** Give up on prestart runs nobody finished, failing the jobs they hold. */
  async giveUpStalePrestart(now = new Date()) {
    const stale = await this.models.automation.listStalePrestartRuns(
      new Date(now.getTime() - PRESTART_GIVE_UP_MS)
    );
    for (const run of stale) {
      await this.models.automation.updateRun(run.id, {
        status: 'timed_out',
        error: 'No runner finished it in time',
        finishedAt: now,
      });
      const automation = await this.models.automation.findById(
        run.automationId
      );
      if (automation && run.hookJobId) {
        await this.resolvePrestart(automation.workspaceId, run.hookJobId);
      }
    }
  }

  /** Start the end hooks of an agent run that just ended. */
  private async startEndHooks(event: Events['registry.job.finished']) {
    const hooks = await this.hooksFor(event.workspaceId, 'end', event);
    if (!hooks.length) return;
    const job = await this.models.registryJob.get(
      event.workspaceId,
      event.jobId
    );
    if (!job) return;
    for (const automation of hooks) {
      await this.start(
        automation,
        { type: 'hook', hook: 'end' },
        { hook: 'end', job: hookJob(job), tasks: event.taskStatuses ?? {} },
        { hook: 'end', hookJobId: job.id }
      ).catch(err => {
        this.logger.warn(
          `end hook ${automation.id} on job ${job.id}: ${(err as Error).message}`
        );
      });
    }
  }

  /** Do what an end hook's output says to the run it wrapped. */
  private async applyEnd(workspaceId: string, run: AutomationRun) {
    if (run.status !== 'succeeded' || !run.hookJobId) return;
    const job = await this.models.registryJob.get(workspaceId, run.hookJobId);
    if (!job) return;
    const automation = await this.models.automation.get(
      workspaceId,
      run.automationId
    );
    const name = automation?.name ?? 'automation';
    const actions = endActions(run.output, job.taskIds ?? []);
    if (actions.tasks && Object.keys(actions.tasks).length) {
      const changed = await this.jobs.setTaskStatuses(job, actions.tasks);
      if (changed.length) {
        this.logger.log(
          `end hook "${name}" set ${changed.length} task(s) on job ${job.id}`
        );
      }
    }
    if (actions.fail) {
      await this.jobs.failAfterEnd(
        workspaceId,
        job.id,
        `Failed by automation "${name}": ${actions.fail}`
      );
    }
  }
}

/** A job's end as a run status; a runner says "timed out" in the error. */
export function runStatus(jobStatus: string, error: string | null) {
  if (jobStatus === 'error' && /^timed out/i.test(error ?? '')) {
    return 'timed_out';
  }
  return JOB_TO_RUN_STATUS[jobStatus] ?? 'failed';
}

/** The runner reports the code's return value as JSON in `result`. */
export function parseOutput(
  result: string | null
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (result === null || result === '') return Prisma.DbNull;
  try {
    return JSON.parse(result) as Prisma.InputJsonValue;
  } catch {
    return result;
  }
}

/** Input kept on a run and sent to the runner; too large is refused. */
export function capInput(input: unknown): Prisma.InputJsonValue | null {
  if (input === undefined || input === null) return null;
  const json = JSON.stringify(input);
  if (Buffer.byteLength(json) > MAX_INPUT_BYTES) {
    throw new BadRequest(`input exceeds ${MAX_INPUT_BYTES} bytes`);
  }
  return JSON.parse(json) as Prisma.InputJsonValue;
}

/**
 * A prestart run unfinished after this long is given up on, so a job held
 * for a hook no runner picks up doesn't wait for ever.
 */
export const PRESTART_GIVE_UP_MS =
  MAX_SHELL_TIMEOUT_SECONDS * 1000 + 15 * 60_000;

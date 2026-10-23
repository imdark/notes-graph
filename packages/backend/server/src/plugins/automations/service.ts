import { Injectable, Logger } from '@nestjs/common';
import { type Automation, type AutomationRun, Prisma } from '@prisma/client';

import { BadRequest, NotFound, OnEvent } from '../../base';
import { Models, RUN_LOG_CAP } from '../../models';
import { RegistryJobService } from '../registry';
import {
  type AutomationEvent,
  type EventFilter,
  matchingTrigger,
  nextRunAt,
  type Trigger,
} from './triggers';

/** What started a run, as kept on the run. */
export interface RunTrigger {
  type: Trigger['type'];
  event?: AutomationEvent;
  /** Who clicked Run, for a manual run. */
  by?: string;
}

/** A doc.updated trigger fires at most once in this long, per automation. */
export const DOC_UPDATED_DEBOUNCE_MS = 60_000;
/** Longest a run may be given. */
export const MAX_TIMEOUT_SECONDS = 15 * 60;
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
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly models: Models,
    private readonly jobs: RegistryJobService
  ) {}

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
    { target, attempt = 1 }: { target?: string; attempt?: number } = {}
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
          timeoutSeconds: automation.timeoutSeconds,
          secrets: automation.secrets,
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

  /** Copy a finished job onto its run, and retry a failure if allowed. */
  private async finishRun(event: Events['registry.job.finished']) {
    const run = await this.models.automation.findRunByJob(event.jobId);
    if (!run) return;
    const job = await this.models.registryJob.get(
      event.workspaceId,
      event.jobId
    );
    const status = runStatus(event.status, event.error);
    await this.models.automation.updateRun(run.id, {
      status,
      output: parseOutput(event.result),
      error: event.error,
      logs: (job?.log ?? '').slice(-RUN_LOG_CAP),
      startedAt: run.startedAt ?? job?.startedAt ?? null,
      finishedAt: new Date(),
    });

    if (status !== 'failed' && status !== 'timed_out') return;
    const automation = await this.models.automation.get(
      event.workspaceId,
      run.automationId
    );
    if (!automation?.enabled || run.attempt > automation.maxRetries) return;
    await this.start(
      automation,
      run.trigger as unknown as RunTrigger,
      run.input,
      { target: run.target, attempt: run.attempt + 1 }
    ).catch(err => {
      this.logger.warn(
        `retrying automation ${automation.id}: ${(err as Error).message}`
      );
    });
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

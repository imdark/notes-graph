import { Injectable, Logger } from '@nestjs/common';
import type { InventoryJob } from '@prisma/client';

// See the note in service.ts: a plain HttpException is reported as a 500 by
// the global filter, so bad input has to be a UserFriendlyError.
import { BadRequest } from '../../base';
import { Models } from '../../models';
import { JOB_TERMINAL } from '../../models/inventory-job';

/** Wire shape for a job. Epoch seconds, matching the device DTO. */
export interface JobDto {
  id: string;
  deviceKey: string;
  agentId: string;
  agentName: string;
  instructions: string;
  context: string;
  model: string | null;
  tools: unknown[];
  maxSteps: number;
  targetKind: string | null;
  docId: string | null;
  blockId: string | null;
  status: string;
  result: string | null;
  error: string | null;
  steps: number;
  /** Device-side tmux session the run is in, for `tmux attach -t`. */
  tmuxSession: string | null;
  claimedBy: string | null;
  /**
   * Transcript text from absolute offset `logFrom` to `logEnd`. Omitted from
   * listings, which would otherwise ship every job's transcript at once.
   */
  log?: string;
  logFrom?: number;
  logEnd?: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface JobDtoOptions {
  /** Include the transcript, starting at this absolute offset (0 = all kept). */
  logFrom?: number;
}

export function toJobDto(job: InventoryJob, options: JobDtoOptions = {}): JobDto {
  return {
    id: job.id,
    deviceKey: job.deviceKey,
    agentId: job.agentId,
    agentName: job.agentName,
    instructions: job.instructions,
    context: job.context,
    model: job.model,
    tools: (job.tools ?? []) as unknown[],
    maxSteps: job.maxSteps,
    targetKind: job.targetKind,
    docId: job.docId,
    blockId: job.blockId,
    status: job.status,
    result: job.result,
    error: job.error,
    steps: job.steps,
    tmuxSession: job.tmuxSession,
    claimedBy: job.claimedBy,
    ...(options.logFrom === undefined ? {} : sliceLog(job, options.logFrom)),
    createdAt: job.createdAt.getTime() / 1000,
    startedAt: job.startedAt ? job.startedAt.getTime() / 1000 : null,
    finishedAt: job.finishedAt ? job.finishedAt.getTime() / 1000 : null,
  };
}

/**
 * The part of a job's transcript at or after `from`.
 *
 * Offsets count code points, not UTF-16 units, because that is what
 * Postgres LENGTH() counts when the append trims the head; counting JS
 * string length instead would drift by one per emoji.
 */
function sliceLog(job: InventoryJob, from: number) {
  const chars = Array.from(job.log);
  const start = Math.max(0, Math.floor(from) - job.logDropped);
  return {
    log: chars.slice(start).join(''),
    logFrom: job.logDropped + start,
    logEnd: job.logDropped + chars.length,
  };
}

const MAX_INSTRUCTIONS = 20_000;
const MAX_CONTEXT = 200_000;

/**
 * Dispatching agent work to registered devices.
 *
 * Enqueue is the only privileged direction: it makes someone else's machine
 * run something. Claiming and reporting are the device's own side of a job
 * it was already given.
 */
@Injectable()
export class InventoryJobService {
  private readonly logger = new Logger(InventoryJobService.name);

  constructor(private readonly models: Models) {}

  async enqueue(
    workspaceId: string,
    userId: string,
    deviceKey: string,
    body: Record<string, unknown>
  ): Promise<JobDto> {
    const device = await this.models.inventoryDevice.get(workspaceId, deviceKey);
    if (!device) {
      throw new BadRequest(`No device '${deviceKey}' in this workspace`);
    }
    // Registering a device is not consent to run code on it. That is a
    // separate opt-in, and it is checked here rather than in the UI so a
    // direct API call cannot skip it.
    if (!device.agentTarget) {
      throw new BadRequest(
        `Device '${deviceKey}' is not an agent target. Re-register it with agent execution allowed.`
      );
    }

    const instructions = String(body.instructions ?? '').trim();
    if (!instructions) {
      throw new BadRequest('instructions are required');
    }
    if (instructions.length > MAX_INSTRUCTIONS) {
      throw new BadRequest(`instructions exceed ${MAX_INSTRUCTIONS} characters`);
    }
    const context = String(body.context ?? '');
    if (context.length > MAX_CONTEXT) {
      throw new BadRequest(`context exceeds ${MAX_CONTEXT} characters`);
    }

    const job = await this.models.inventoryJob.create({
      workspaceId,
      deviceKey,
      agentId: String(body.agentId ?? ''),
      agentName: String(body.agentName ?? 'agent').slice(0, 200),
      instructions,
      context,
      model: body.model ? String(body.model) : null,
      tools: (Array.isArray(body.tools) ? body.tools : []) as never,
      maxSteps: Number(body.maxSteps ?? 8),
      targetKind: body.targetKind ? String(body.targetKind) : null,
      docId: body.docId ? String(body.docId) : null,
      blockId: body.blockId ? String(body.blockId) : null,
      createdBy: userId,
    });

    this.logger.log(`queued job ${job.id} for ${workspaceId}/${deviceKey}`);
    return toJobDto(job);
  }

  async get(
    workspaceId: string,
    id: string,
    logFrom?: number
  ): Promise<JobDto | null> {
    const job = await this.models.inventoryJob.get(workspaceId, id);
    return job ? toJobDto(job, { logFrom }) : null;
  }

  async list(workspaceId: string, deviceKey?: string, status?: string): Promise<JobDto[]> {
    const jobs = await this.models.inventoryJob.list(workspaceId, { deviceKey, status });
    return jobs.map(job => toJobDto(job));
  }

  async claim(
    workspaceId: string,
    deviceKey: string,
    runnerId: string,
    leaseSeconds?: number
  ): Promise<JobDto | null> {
    const job = await this.models.inventoryJob.claim(
      workspaceId, deviceKey, runnerId || 'runner', leaseSeconds
    );
    return job ? toJobDto(job) : null;
  }

  async report(
    workspaceId: string,
    id: string,
    body: Record<string, unknown>
  ): Promise<JobDto | null> {
    const status = body.status ? String(body.status) : undefined;
    if (status && !['running', ...JOB_TERMINAL].includes(status)) {
      throw new BadRequest(
        `status must be one of running, ${JOB_TERMINAL.join(', ')}`
      );
    }
    const job = await this.models.inventoryJob.report(workspaceId, id, {
      status,
      result: body.result === undefined ? undefined : String(body.result ?? ''),
      error: body.error === undefined ? undefined : String(body.error ?? ''),
      steps: body.steps === undefined ? undefined : Number(body.steps),
      logAppend: body.logAppend ? String(body.logAppend) : undefined,
      tmuxSession: body.tmuxSession ? String(body.tmuxSession).slice(0, 200) : undefined,
      leaseSeconds: body.leaseSeconds === undefined ? undefined : Number(body.leaseSeconds),
    });
    return job ? toJobDto(job) : null;
  }

  async cancel(workspaceId: string, id: string): Promise<JobDto | null> {
    const job = await this.models.inventoryJob.cancel(workspaceId, id);
    return job ? toJobDto(job) : null;
  }
}

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { InventoryJob } from '@prisma/client';

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
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export function toJobDto(job: InventoryJob): JobDto {
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
    createdAt: job.createdAt.getTime() / 1000,
    startedAt: job.startedAt ? job.startedAt.getTime() / 1000 : null,
    finishedAt: job.finishedAt ? job.finishedAt.getTime() / 1000 : null,
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
      throw new BadRequestException(`No device '${deviceKey}' in this workspace`);
    }
    // Registering a device is not consent to run code on it. That is a
    // separate opt-in, and it is checked here rather than in the UI so a
    // direct API call cannot skip it.
    if (!device.agentTarget) {
      throw new BadRequestException(
        `Device '${deviceKey}' is not an agent target. Re-register it with agent execution allowed.`
      );
    }

    const instructions = String(body.instructions ?? '').trim();
    if (!instructions) {
      throw new BadRequestException('instructions are required');
    }
    if (instructions.length > MAX_INSTRUCTIONS) {
      throw new BadRequestException(`instructions exceed ${MAX_INSTRUCTIONS} characters`);
    }
    const context = String(body.context ?? '');
    if (context.length > MAX_CONTEXT) {
      throw new BadRequestException(`context exceeds ${MAX_CONTEXT} characters`);
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

  async get(workspaceId: string, id: string): Promise<JobDto | null> {
    const job = await this.models.inventoryJob.get(workspaceId, id);
    return job ? toJobDto(job) : null;
  }

  async list(workspaceId: string, deviceKey?: string, status?: string): Promise<JobDto[]> {
    const jobs = await this.models.inventoryJob.list(workspaceId, { deviceKey, status });
    return jobs.map(toJobDto);
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
      throw new BadRequestException(
        `status must be one of running, ${JOB_TERMINAL.join(', ')}`
      );
    }
    const job = await this.models.inventoryJob.report(workspaceId, id, {
      status,
      result: body.result === undefined ? undefined : String(body.result ?? ''),
      error: body.error === undefined ? undefined : String(body.error ?? ''),
      steps: body.steps === undefined ? undefined : Number(body.steps),
      leaseSeconds: body.leaseSeconds === undefined ? undefined : Number(body.leaseSeconds),
    });
    return job ? toJobDto(job) : null;
  }

  async cancel(workspaceId: string, id: string): Promise<JobDto | null> {
    const job = await this.models.inventoryJob.cancel(workspaceId, id);
    return job ? toJobDto(job) : null;
  }
}

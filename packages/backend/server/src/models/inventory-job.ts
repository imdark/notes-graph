import { Injectable } from '@nestjs/common';
import type { InventoryJob, Prisma } from '@prisma/client';

import { BaseModel } from './base';

/** Terminal states: a job in one of these is never handed out again. */
export const JOB_TERMINAL = ['done', 'error', 'cancelled'] as const;
export const JOB_STATUSES = ['queued', 'running', ...JOB_TERMINAL] as const;

export interface CreateInventoryJobInput {
  workspaceId: string;
  deviceKey: string;
  agentId: string;
  agentName: string;
  instructions: string;
  context: string;
  model?: string | null;
  tools?: Prisma.InputJsonValue;
  maxSteps?: number;
  targetKind?: string | null;
  docId?: string | null;
  blockId?: string | null;
  createdBy?: string | null;
}

export interface ReportInventoryJobInput {
  status?: string;
  result?: string | null;
  error?: string | null;
  steps?: number;
  /** Extends the lease while a long run is still making progress. */
  leaseSeconds?: number;
}

@Injectable()
export class InventoryJobModel extends BaseModel {
  async create(input: CreateInventoryJobInput): Promise<InventoryJob> {
    return this.db.inventoryJob.create({
      data: {
        workspaceId: input.workspaceId,
        deviceKey: input.deviceKey,
        agentId: input.agentId,
        agentName: input.agentName,
        instructions: input.instructions,
        context: input.context,
        model: input.model ?? null,
        tools: input.tools ?? [],
        maxSteps: input.maxSteps ?? 8,
        targetKind: input.targetKind ?? null,
        docId: input.docId ?? null,
        blockId: input.blockId ?? null,
        createdBy: input.createdBy ?? null,
      },
    });
  }

  async get(workspaceId: string, id: string): Promise<InventoryJob | null> {
    const job = await this.db.inventoryJob.findUnique({ where: { id } });
    // Scope by workspace here rather than trusting the id alone: a uuid from
    // another workspace must read as absent, not as someone else's job.
    return job && job.workspaceId === workspaceId ? job : null;
  }

  async list(
    workspaceId: string,
    filter: { deviceKey?: string; status?: string; limit?: number } = {}
  ): Promise<InventoryJob[]> {
    return this.db.inventoryJob.findMany({
      where: {
        workspaceId,
        ...(filter.deviceKey ? { deviceKey: filter.deviceKey } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filter.limit ?? 50,
    });
  }

  /**
   * Hand the oldest queued job for a device to one runner.
   *
   * The update is conditional on the row still being claimable, so two
   * runners racing on the same device cannot both win: the loser's
   * updateMany matches nothing and it retries. A job whose lease has expired
   * is claimable again, which is what recovers work from a runner that died
   * mid-run.
   */
  async claim(
    workspaceId: string,
    deviceKey: string,
    runnerId: string,
    leaseSeconds = 300
  ): Promise<InventoryJob | null> {
    const now = new Date();
    const candidate = await this.db.inventoryJob.findFirst({
      where: {
        workspaceId,
        deviceKey,
        OR: [
          { status: 'queued' },
          { status: 'running', leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) {
      return null;
    }

    const lease = new Date(now.getTime() + leaseSeconds * 1000);
    const { count } = await this.db.inventoryJob.updateMany({
      where: {
        id: candidate.id,
        // Re-assert the claimable condition; if another runner took it
        // between the read and this write, count comes back 0.
        OR: [
          { status: 'queued' },
          { status: 'running', leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: 'running',
        claimedBy: runnerId,
        leaseExpiresAt: lease,
        startedAt: candidate.startedAt ?? now,
      },
    });
    if (count === 0) {
      return null;
    }
    return this.db.inventoryJob.findUnique({ where: { id: candidate.id } });
  }

  async report(
    workspaceId: string,
    id: string,
    input: ReportInventoryJobInput
  ): Promise<InventoryJob | null> {
    const job = await this.get(workspaceId, id);
    if (!job) {
      return null;
    }
    // A cancelled job stays cancelled: the user's decision outranks a report
    // from a runner that had not noticed yet.
    if (job.status === 'cancelled') {
      return job;
    }

    const status = input.status ?? job.status;
    const terminal = (JOB_TERMINAL as readonly string[]).includes(status);
    return this.db.inventoryJob.update({
      where: { id },
      data: {
        status,
        result: input.result ?? job.result,
        error: input.error ?? job.error,
        steps: input.steps ?? job.steps,
        finishedAt: terminal ? new Date() : null,
        leaseExpiresAt: terminal
          ? null
          : new Date(Date.now() + (input.leaseSeconds ?? 300) * 1000),
      },
    });
  }

  async cancel(workspaceId: string, id: string): Promise<InventoryJob | null> {
    const job = await this.get(workspaceId, id);
    if (!job) {
      return null;
    }
    if ((JOB_TERMINAL as readonly string[]).includes(job.status)) {
      return job;   // already finished; nothing to cancel
    }
    return this.db.inventoryJob.update({
      where: { id },
      data: { status: 'cancelled', finishedAt: new Date(), leaseExpiresAt: null },
    });
  }
}

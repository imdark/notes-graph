import { Injectable } from '@nestjs/common';
import type {
  MonitoringAgent,
  MonitoringBaseline,
  MonitoringDecision,
  Prisma,
} from '@prisma/client';

import { BaseModel } from './base';

export type { MonitoringAgent, MonitoringBaseline, MonitoringDecision };

/** Decisions kept per workspace; older ones are dropped as new ones land. */
const DECISIONS_KEPT = 500;

export interface UpdateMonitoringAgentInput {
  mode?: string;
  sensitivity?: number;
  intervalMinutes?: number;
  autoTriage?: boolean;
  alerts?: Prisma.InputJsonValue;
  updatedBy: string;
  nextRunAt?: Date;
}

export interface CreateMonitoringDecisionInput {
  workspaceId: string;
  deviceKey: string;
  metric: string;
  kind: string;
  severity: string;
  value?: number | null;
  baseline?: number | null;
  score?: number | null;
  summary: string;
  action: string;
}

/**
 * The monitoring agent's settings, what it has learned (baselines), and what
 * it noticed (decisions). See plugins/inventory/monitoring-agent.
 */
@Injectable()
export class MonitoringAgentModel extends BaseModel {
  async get(workspaceId: string) {
    return await this.db.monitoringAgent.findUnique({ where: { workspaceId } });
  }

  async upsert(workspaceId: string, data: UpdateMonitoringAgentInput) {
    return await this.db.monitoringAgent.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data },
      update: data,
    });
  }

  async touch(workspaceId: string, data: { lastRunAt?: Date; nextRunAt?: Date }) {
    return await this.db.monitoringAgent.update({ where: { workspaceId }, data });
  }

  /** Agents due to check their machines, oldest first. */
  async listDue(now: Date, limit: number) {
    return await this.db.monitoringAgent.findMany({
      where: { nextRunAt: { lte: now }, intervalMinutes: { gt: 0 } },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
    });
  }

  async listBaselines(workspaceId: string, deviceKey?: string) {
    return await this.db.monitoringBaseline.findMany({
      where: { workspaceId, ...(deviceKey ? { deviceKey } : {}) },
      orderBy: [{ deviceKey: 'asc' }, { metric: 'asc' }],
    });
  }

  async saveBaseline(
    workspaceId: string,
    deviceKey: string,
    metric: string,
    data: { mean: number; variance: number; samples: number; lastValue: number | null }
  ) {
    return await this.db.monitoringBaseline.upsert({
      where: { workspaceId_deviceKey_metric: { workspaceId, deviceKey, metric } },
      create: { workspaceId, deviceKey, metric, ...data },
      update: data,
    });
  }

  /** Forget what was learned: everything, or one machine's. */
  async clearBaselines(workspaceId: string, deviceKey?: string) {
    const { count } = await this.db.monitoringBaseline.deleteMany({
      where: { workspaceId, ...(deviceKey ? { deviceKey } : {}) },
    });
    return count;
  }

  async addDecision(input: CreateMonitoringDecisionInput) {
    const row = await this.db.monitoringDecision.create({ data: input });
    const cutoff = await this.db.monitoringDecision.findFirst({
      where: { workspaceId: input.workspaceId },
      orderBy: { createdAt: 'desc' },
      skip: DECISIONS_KEPT - 1,
      select: { createdAt: true },
    });
    if (cutoff) {
      await this.db.monitoringDecision.deleteMany({
        where: { workspaceId: input.workspaceId, createdAt: { lt: cutoff.createdAt } },
      });
    }
    return row;
  }

  async getDecision(workspaceId: string, id: string) {
    const row = await this.db.monitoringDecision.findUnique({ where: { id } });
    return row?.workspaceId === workspaceId ? row : null;
  }

  async listDecisions(workspaceId: string, limit = 100) {
    return await this.db.monitoringDecision.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** The newest decision on one reading of one machine, for de-duplication. */
  async lastDecision(workspaceId: string, deviceKey: string, metric: string) {
    return await this.db.monitoringDecision.findFirst({
      where: { workspaceId, deviceKey, metric },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByTriageJob(jobId: string) {
    return await this.db.monitoringDecision.findFirst({ where: { triageJobId: jobId } });
  }

  async updateDecision(id: string, data: Prisma.MonitoringDecisionUpdateInput) {
    return await this.db.monitoringDecision.update({ where: { id }, data });
  }
}

import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type {
  Automation,
  AutomationDeployment,
  AutomationRun,
  AutomationVersion,
  Prisma,
} from '@prisma/client';

import { BaseModel } from './base';

export type {
  Automation,
  AutomationDeployment,
  AutomationRun,
  AutomationVersion,
};

/** Runs kept per automation; older ones are dropped as new ones start. */
const RUNS_KEPT = 200;
/** Most log text kept per run; past it the head is dropped. */
export const RUN_LOG_CAP = 100_000;

export const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

export interface CreateAutomationInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  docId?: string | null;
  blockId?: string | null;
  triggers: Prisma.InputJsonValue;
  secrets?: string[];
  timeoutSeconds?: number;
  maxRetries?: number;
  enabled?: boolean;
  nextRunAt?: Date | null;
}

export interface CreateRunInput {
  automationId: string;
  versionId: string;
  target: string;
  trigger: Prisma.InputJsonValue;
  input?: Prisma.InputJsonValue | null;
  attempt?: number;
}

@Injectable()
export class AutomationModel extends BaseModel {
  async create(input: CreateAutomationInput) {
    return await this.db.automation.create({ data: input });
  }

  async get(workspaceId: string, id: string) {
    const automation = await this.db.automation.findUnique({ where: { id } });
    return automation?.workspaceId === workspaceId ? automation : null;
  }

  async list(workspaceId: string) {
    return await this.db.automation.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(id: string, data: Prisma.AutomationUpdateInput) {
    return await this.db.automation.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.db.automation.delete({ where: { id } });
  }

  /** Enabled automations whose next scheduled run is due, oldest first. */
  async listDue(now: Date, limit: number) {
    return await this.db.automation.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
    });
  }

  /** Enabled automations in a workspace with any event trigger. */
  async listWithEventTriggers(workspaceId: string) {
    return await this.db.automation.findMany({
      where: {
        workspaceId,
        enabled: true,
        triggers: { array_contains: [{ type: 'event' }] },
      },
    });
  }

  async findByWebhookToken(token: string) {
    return await this.db.automation.findUnique({
      where: { webhookTokenHash: sha256(token) },
    });
  }

  /**
   * Save code as the next version, or return the latest one if it already
   * holds this exact code.
   */
  async addVersion(automationId: string, code: string, createdBy: string) {
    const hash = sha256(code);
    const latest = await this.db.automationVersion.findFirst({
      where: { automationId },
      orderBy: { number: 'desc' },
    });
    if (latest?.hash === hash) return latest;
    return await this.db.automationVersion.create({
      data: {
        automationId,
        number: (latest?.number ?? 0) + 1,
        code,
        hash,
        createdBy,
      },
    });
  }

  async getVersion(automationId: string, id: string) {
    const version = await this.db.automationVersion.findUnique({
      where: { id },
    });
    return version?.automationId === automationId ? version : null;
  }

  async latestVersion(automationId: string) {
    return await this.db.automationVersion.findFirst({
      where: { automationId },
      orderBy: { number: 'desc' },
    });
  }

  async listVersions(automationId: string, limit = 50) {
    return await this.db.automationVersion.findMany({
      where: { automationId },
      orderBy: { number: 'desc' },
      take: limit,
      select: {
        id: true,
        number: true,
        hash: true,
        createdBy: true,
        createdAt: true,
      },
    });
  }

  /** Point a target at a version; one deployment per target. */
  async deploy(
    automationId: string,
    target: string,
    versionId: string,
    deployedBy: string
  ) {
    return await this.db.automationDeployment.upsert({
      where: { automationId_target: { automationId, target } },
      create: { automationId, target, versionId, deployedBy },
      update: { versionId, deployedBy },
    });
  }

  async undeploy(automationId: string, target: string) {
    await this.db.automationDeployment.deleteMany({
      where: { automationId, target },
    });
  }

  async listDeployments(automationId: string) {
    return await this.db.automationDeployment.findMany({
      where: { automationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createRun(input: CreateRunInput) {
    const run = await this.db.automationRun.create({
      data: {
        ...input,
        input: input.input ?? undefined,
      },
    });
    // Keep the newest RUNS_KEPT: find the cutoff, drop what is older.
    const cutoff = await this.db.automationRun.findFirst({
      where: { automationId: input.automationId },
      orderBy: { createdAt: 'desc' },
      skip: RUNS_KEPT - 1,
      select: { createdAt: true },
    });
    if (cutoff) {
      await this.db.automationRun.deleteMany({
        where: {
          automationId: input.automationId,
          createdAt: { lt: cutoff.createdAt },
        },
      });
    }
    return run;
  }

  async getRun(automationId: string, id: string) {
    const run = await this.db.automationRun.findUnique({ where: { id } });
    return run?.automationId === automationId ? run : null;
  }

  async findRunByJob(jobId: string) {
    return await this.db.automationRun.findUnique({ where: { jobId } });
  }

  async updateRun(id: string, data: Prisma.AutomationRunUpdateInput) {
    return await this.db.automationRun.update({ where: { id }, data });
  }

  async listRuns(automationId: string, limit = 50) {
    return await this.db.automationRun.findMany({
      where: { automationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

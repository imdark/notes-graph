import { Injectable } from '@nestjs/common';
import type { Monitor, MonitorReading, Prisma } from '@prisma/client';

import { BaseModel } from './base';

export type { Monitor, MonitorReading };

/** Readings kept per monitor; older ones are dropped as new ones land. */
const READINGS_KEPT = 200;

export interface CreateMonitorInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  docId: string;
  blockId: string;
  kind: string;
  source?: string | null;
  deviceKey?: string | null;
  spec: Prisma.InputJsonValue;
  intervalMinutes: number;
  condition: Prisma.InputJsonValue;
  alerts: Prisma.InputJsonValue;
  enabled?: boolean;
}

export type UpdateMonitorInput = Partial<
  Omit<CreateMonitorInput, 'workspaceId' | 'createdBy'>
>;

@Injectable()
export class MonitorModel extends BaseModel {
  async create(input: CreateMonitorInput) {
    return await this.db.monitor.create({ data: input });
  }

  async get(id: string) {
    return await this.db.monitor.findUnique({ where: { id } });
  }

  async listByUser(workspaceId: string, createdBy: string) {
    return await this.db.monitor.findMany({
      where: { workspaceId, createdBy },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(id: string, data: Prisma.MonitorUpdateInput) {
    return await this.db.monitor.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.db.monitor.delete({ where: { id } });
  }

  /** Enabled monitors whose next run is due, oldest first. */
  async listDue(now: Date, limit: number) {
    return await this.db.monitor.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      select: { id: true },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
    });
  }

  /** The monitor waiting on this device job, if any. */
  async findByPendingJob(jobId: string) {
    return await this.db.monitor.findFirst({ where: { pendingJobId: jobId } });
  }

  async addReading(
    monitorId: string,
    reading: { value: string | null; error?: string | null; changed: boolean; alerted: boolean }
  ) {
    const row = await this.db.monitorReading.create({
      data: { monitorId, ...reading },
    });
    // Keep the newest READINGS_KEPT: find the cutoff, drop what is older.
    const cutoff = await this.db.monitorReading.findFirst({
      where: { monitorId },
      orderBy: { at: 'desc' },
      skip: READINGS_KEPT - 1,
      select: { at: true },
    });
    if (cutoff) {
      await this.db.monitorReading.deleteMany({
        where: { monitorId, at: { lt: cutoff.at } },
      });
    }
    return row;
  }

  async listReadings(monitorId: string, limit = 50) {
    return await this.db.monitorReading.findMany({
      where: { monitorId },
      orderBy: { at: 'desc' },
      take: limit,
    });
  }
}

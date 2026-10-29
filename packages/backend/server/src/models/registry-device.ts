import { Injectable } from '@nestjs/common';
import type { Prisma, RegistryDevice } from '@prisma/client';

import { BaseModel } from './base';

export interface UpsertRegistryDeviceInput {
  workspaceId: string;
  key: string;
  name: string;
  kind?: string;
  host?: string;
  user?: string;
  port?: number;
  parentKey?: string | null;
  path?: string | null;
  recipe?: string;
  repo?: string | null;
  branch?: string;
  channel?: string;
  pin?: string | null;
  agentTarget?: boolean;
  labels?: Prisma.InputJsonValue;
  registeredBy?: string | null;
}

export interface UpdateRegistryDeviceStatusInput {
  state?: string;
  statusDetail?: string | null;
  version?: string | null;
  checkedAt?: Date | null;
  checks?: Prisma.InputJsonValue;
}

/**
 * Devices registered as deployment or agent-execution targets.
 *
 * `key` is the registering tool's own identifier, unique per workspace, so
 * re-registering a machine updates the existing row instead of creating a
 * duplicate. Status is written by a separate call because health runs are
 * far more frequent than registrations and must not have to resend the
 * whole record.
 */
@Injectable()
export class RegistryDeviceModel extends BaseModel {
  async upsert(input: UpsertRegistryDeviceInput): Promise<RegistryDevice> {
    const { workspaceId, key, ...rest } = input;
    const data = {
      name: rest.name,
      kind: rest.kind ?? 'machine',
      host: rest.host ?? '',
      user: rest.user ?? '',
      port: rest.port ?? 22,
      parentKey: rest.parentKey ?? null,
      path: rest.path ?? null,
      recipe: rest.recipe ?? 'generic',
      repo: rest.repo ?? null,
      branch: rest.branch ?? 'main',
      channel: rest.channel ?? 'stable',
      pin: rest.pin ?? null,
      agentTarget: rest.agentTarget ?? false,
      labels: rest.labels ?? {},
    };

    return this.db.registryDevice.upsert({
      where: { workspaceId_key: { workspaceId, key } },
      // Registration never clears a status the device already reported.
      create: {
        workspaceId,
        key,
        registeredBy: rest.registeredBy ?? null,
        ...data,
      },
      update: data,
    });
  }

  async get(workspaceId: string, key: string): Promise<RegistryDevice | null> {
    return this.db.registryDevice.findUnique({
      where: { workspaceId_key: { workspaceId, key } },
    });
  }

  async list(
    workspaceId: string,
    filter: { kind?: string; agentTarget?: boolean } = {}
  ): Promise<RegistryDevice[]> {
    return this.db.registryDevice.findMany({
      where: {
        workspaceId,
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(filter.agentTarget === undefined
          ? {}
          : { agentTarget: filter.agentTarget }),
      },
      orderBy: { key: 'asc' },
    });
  }

  async delete(workspaceId: string, key: string): Promise<number> {
    // Folder targets are meaningless without the machine they sit on, so a
    // machine's children go with it.
    const { count } = await this.db.registryDevice.deleteMany({
      where: { workspaceId, OR: [{ key }, { parentKey: key }] },
    });
    return count;
  }

  /**
   * Note that a runner on the device just asked for work, so a run waiting in
   * its queue can tell "no runner is listening" from "busy". Written at most
   * every 30s — runners poll every few seconds — and without bumping
   * `updated_at`, which tracks registration and status, not polling.
   */
  async touchRunner(workspaceId: string, key: string): Promise<void> {
    await this.db.$executeRaw`
      UPDATE "registry_devices"
      SET "runner_seen_at" = NOW()
      WHERE "workspace_id" = ${workspaceId} AND "key" = ${key}
        AND ("runner_seen_at" IS NULL
          OR "runner_seen_at" < NOW() - INTERVAL '30 seconds')`;
  }

  /** How many jobs the device's runners may run at once; null for theirs. */
  async setMaxJobs(
    workspaceId: string,
    key: string,
    maxJobs: number | null
  ): Promise<RegistryDevice | null> {
    const { count } = await this.db.registryDevice.updateMany({
      where: { workspaceId, key },
      data: { maxJobs },
    });
    return count ? this.get(workspaceId, key) : null;
  }

  /** Whether only server admins may run jobs here. */
  async setAdminOnly(
    workspaceId: string,
    key: string,
    adminOnly: boolean
  ): Promise<RegistryDevice | null> {
    const { count } = await this.db.registryDevice.updateMany({
      where: { workspaceId, key },
      data: { adminOnly },
    });
    return count ? this.get(workspaceId, key) : null;
  }

  async updateStatus(
    workspaceId: string,
    key: string,
    input: UpdateRegistryDeviceStatusInput
  ): Promise<RegistryDevice | null> {
    const existing = await this.get(workspaceId, key);
    if (!existing) {
      return null;
    }
    return this.db.registryDevice.update({
      where: { workspaceId_key: { workspaceId, key } },
      data: {
        state: input.state ?? existing.state,
        statusDetail: input.statusDetail ?? null,
        version: input.version ?? existing.version,
        checkedAt: input.checkedAt ?? new Date(),
        checks: input.checks ?? [],
      },
    });
  }
}

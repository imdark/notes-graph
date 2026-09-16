import { Injectable } from '@nestjs/common';
import type { InventoryDevice, Prisma } from '@prisma/client';

import { BaseModel } from './base';

export interface UpsertInventoryDeviceInput {
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

export interface UpdateInventoryDeviceStatusInput {
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
export class InventoryDeviceModel extends BaseModel {
  async upsert(input: UpsertInventoryDeviceInput): Promise<InventoryDevice> {
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

    return this.db.inventoryDevice.upsert({
      where: { workspaceId_key: { workspaceId, key } },
      // Registration never clears a status the device already reported.
      create: { workspaceId, key, registeredBy: rest.registeredBy ?? null, ...data },
      update: data,
    });
  }

  async get(workspaceId: string, key: string): Promise<InventoryDevice | null> {
    return this.db.inventoryDevice.findUnique({
      where: { workspaceId_key: { workspaceId, key } },
    });
  }

  async list(
    workspaceId: string,
    filter: { kind?: string; agentTarget?: boolean } = {}
  ): Promise<InventoryDevice[]> {
    return this.db.inventoryDevice.findMany({
      where: {
        workspaceId,
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(filter.agentTarget === undefined ? {} : { agentTarget: filter.agentTarget }),
      },
      orderBy: { key: 'asc' },
    });
  }

  async delete(workspaceId: string, key: string): Promise<number> {
    // Folder targets are meaningless without the machine they sit on, so a
    // machine's children go with it.
    const { count } = await this.db.inventoryDevice.deleteMany({
      where: { workspaceId, OR: [{ key }, { parentKey: key }] },
    });
    return count;
  }

  async updateStatus(
    workspaceId: string,
    key: string,
    input: UpdateInventoryDeviceStatusInput
  ): Promise<InventoryDevice | null> {
    const existing = await this.get(workspaceId, key);
    if (!existing) {
      return null;
    }
    return this.db.inventoryDevice.update({
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

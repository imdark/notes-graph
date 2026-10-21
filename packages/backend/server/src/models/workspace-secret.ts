import { Injectable } from '@nestjs/common';

import { CryptoHelper } from '../base';
import { BaseModel } from './base';

export interface UpsertWorkspaceSecretInput {
  workspaceId: string;
  name: string;
  description?: string | null;
  // Leave out to keep the stored value and change only the description.
  value?: string | null;
  userId?: string;
}

// What clients may see about a secret: everything but its value.
const metadata = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class WorkspaceSecretModel extends BaseModel {
  constructor(private readonly crypto: CryptoHelper) {
    super();
  }

  async list(workspaceId: string) {
    return await this.db.workspaceSecret.findMany({
      where: { workspaceId },
      select: metadata,
      orderBy: { name: 'asc' },
    });
  }

  async get(workspaceId: string, name: string) {
    return await this.db.workspaceSecret.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
      select: metadata,
    });
  }

  // For server-side use only (e.g. handing secrets to an agent run).
  async reveal(workspaceId: string, name: string) {
    const row = await this.db.workspaceSecret.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
      select: { encryptedValue: true },
    });
    return row ? this.crypto.decrypt(row.encryptedValue) : null;
  }

  async upsert(input: UpsertWorkspaceSecretInput) {
    const encryptedValue = input.value
      ? this.crypto.encrypt(input.value)
      : undefined;
    const description =
      input.description === undefined ? undefined : input.description || null;

    if (!encryptedValue) {
      return await this.db.workspaceSecret.update({
        where: {
          workspaceId_name: {
            workspaceId: input.workspaceId,
            name: input.name,
          },
        },
        data: { description, updatedBy: input.userId },
        select: metadata,
      });
    }

    return await this.db.workspaceSecret.upsert({
      where: {
        workspaceId_name: { workspaceId: input.workspaceId, name: input.name },
      },
      create: {
        workspaceId: input.workspaceId,
        name: input.name,
        description: description ?? null,
        encryptedValue,
        createdBy: input.userId,
        updatedBy: input.userId,
      },
      update: { description, encryptedValue, updatedBy: input.userId },
      select: metadata,
    });
  }

  async rename(
    workspaceId: string,
    name: string,
    newName: string,
    userId?: string
  ) {
    return await this.db.workspaceSecret.update({
      where: { workspaceId_name: { workspaceId, name } },
      data: { name: newName, updatedBy: userId },
      select: metadata,
    });
  }

  async delete(workspaceId: string, name: string) {
    const { count } = await this.db.workspaceSecret.deleteMany({
      where: { workspaceId, name },
    });
    return count > 0;
  }
}

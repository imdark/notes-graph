import { Injectable } from '@nestjs/common';

import { BaseModel } from './base';

export type DirectorySyncScopeType = 'group' | 'org_unit';

export interface CreateDirectorySyncScopeInput {
  directoryAccountId: string;
  projectId: string;
  scopeType: DirectorySyncScopeType;
  externalId: string;
  label?: string | null;
}

@Injectable()
export class DirectorySyncScopeModel extends BaseModel {
  async create(input: CreateDirectorySyncScopeInput) {
    return await this.db.directorySyncScope.create({ data: input });
  }

  async get(id: string) {
    return await this.db.directorySyncScope.findUnique({ where: { id } });
  }

  async listByAccount(directoryAccountId: string) {
    return await this.db.directorySyncScope.findMany({
      where: { directoryAccountId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listDue() {
    return await this.db.directorySyncScope.findMany({
      where: { status: 'active' },
    });
  }

  async updateLabel(id: string, label: string | null) {
    return await this.db.directorySyncScope.update({
      where: { id },
      data: { label },
    });
  }

  async touchSync(id: string, lastError?: string | null) {
    return await this.db.directorySyncScope.update({
      where: { id },
      data: { lastSyncAt: new Date(), lastError: lastError ?? null },
    });
  }

  async updateStatus(id: string, status: string, lastError?: string | null) {
    return await this.db.directorySyncScope.update({
      where: { id },
      data: { status, lastError: lastError ?? null },
    });
  }

  async delete(id: string) {
    return await this.db.directorySyncScope.delete({ where: { id } });
  }
}

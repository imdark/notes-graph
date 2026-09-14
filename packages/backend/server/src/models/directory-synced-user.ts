import { Injectable } from '@nestjs/common';

import { BaseModel } from './base';

@Injectable()
export class DirectorySyncedUserModel extends BaseModel {
  async listByScope(scopeId: string) {
    return await this.db.directorySyncedUser.findMany({ where: { scopeId } });
  }

  async listActiveByScope(scopeId: string) {
    return await this.db.directorySyncedUser.findMany({
      where: { scopeId, status: 'active' },
    });
  }

  async get(scopeId: string, externalUserId: string) {
    return await this.db.directorySyncedUser.findUnique({
      where: { scopeId_externalUserId: { scopeId, externalUserId } },
    });
  }

  /** Marks an externally-listed user as seen this cycle, resetting the missed-cycle counter. */
  async markSeen(
    scopeId: string,
    externalUserId: string,
    email: string,
    workspaceUserId?: string | null
  ) {
    return await this.db.directorySyncedUser.upsert({
      where: { scopeId_externalUserId: { scopeId, externalUserId } },
      create: {
        scopeId,
        externalUserId,
        email,
        workspaceUserId: workspaceUserId ?? null,
        status: 'active',
        missedSyncCount: 0,
        lastSeenAt: new Date(),
      },
      update: {
        email,
        workspaceUserId: workspaceUserId ?? undefined,
        status: 'active',
        missedSyncCount: 0,
        lastSeenAt: new Date(),
      },
    });
  }

  /** Bumps the missed-cycle counter for a synced user absent from this cycle's directory listing. */
  async incrementMissed(scopeId: string, externalUserId: string) {
    return await this.db.directorySyncedUser.update({
      where: { scopeId_externalUserId: { scopeId, externalUserId } },
      data: { missedSyncCount: { increment: 1 } },
    });
  }

  async markRemoved(scopeId: string, externalUserId: string) {
    return await this.db.directorySyncedUser.update({
      where: { scopeId_externalUserId: { scopeId, externalUserId } },
      data: { status: 'removed' },
    });
  }

  async delete(scopeId: string, externalUserId: string) {
    return await this.db.directorySyncedUser.delete({
      where: { scopeId_externalUserId: { scopeId, externalUserId } },
    });
  }
}

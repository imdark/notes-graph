import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Prisma, RegistryJobShare } from '@prisma/client';

import { BaseModel } from './base';

export interface RegistryJobShareSnapshot {
  workspaceId: string;
  jobId: string;
  title: string | null;
  status: string;
  log: string;
  result: string | null;
  error: string | null;
  questions: Prisma.InputJsonValue;
  createdBy: string;
}

@Injectable()
export class RegistryJobShareModel extends BaseModel {
  /**
   * Share a run, or refresh its snapshot. The token is kept across refreshes
   * so a link already sent keeps working and shows the newer copy.
   */
  async upsert(snapshot: RegistryJobShareSnapshot): Promise<RegistryJobShare> {
    const { jobId, ...rest } = snapshot;
    return this.db.registryJobShare.upsert({
      where: { jobId },
      // 24 random bytes: the token is the only thing guarding the link.
      create: { token: randomBytes(24).toString('base64url'), jobId, ...rest },
      update: rest,
    });
  }

  async getByJob(
    workspaceId: string,
    jobId: string
  ): Promise<RegistryJobShare | null> {
    const share = await this.db.registryJobShare.findUnique({ where: { jobId } });
    return share && share.workspaceId === workspaceId ? share : null;
  }

  async getByToken(token: string): Promise<RegistryJobShare | null> {
    return this.db.registryJobShare.findUnique({ where: { token } });
  }

  async revoke(workspaceId: string, jobId: string): Promise<number> {
    const { count } = await this.db.registryJobShare.deleteMany({
      where: { workspaceId, jobId },
    });
    return count;
  }
}

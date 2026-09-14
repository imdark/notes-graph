import { Injectable } from '@nestjs/common';
import type { DirectoryAccount, Prisma } from '@prisma/client';

import { CryptoHelper } from '../base';
import { BaseModel } from './base';

export interface DirectoryAccountTokens {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scope?: string | null;
}

export interface UpsertDirectoryAccountInput extends DirectoryAccountTokens {
  workspaceId: string;
  connectedByUserId: string;
  provider?: string;
  domain: string;
  status?: string | null;
  lastError?: string | null;
}

export interface UpdateDirectoryAccountTokensInput
  extends DirectoryAccountTokens {
  status?: string | null;
  lastError?: string | null;
}

@Injectable()
export class DirectoryAccountModel extends BaseModel {
  constructor(private readonly crypto: CryptoHelper) {
    super();
  }

  private encryptToken(token?: string | null) {
    return token ? this.crypto.encrypt(token) : null;
  }

  private decryptToken(token?: string | null) {
    return token ? this.crypto.decrypt(token) : null;
  }

  async listByWorkspace(workspaceId: string) {
    return await this.db.directoryAccount.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    return await this.db.directoryAccount.findUnique({ where: { id } });
  }

  async getByWorkspace(workspaceId: string, provider = 'google') {
    return await this.db.directoryAccount.findUnique({
      where: { workspaceId_provider: { workspaceId, provider } },
    });
  }

  async upsert(input: UpsertDirectoryAccountInput) {
    const accessToken = this.encryptToken(input.accessToken);
    const refreshToken = this.encryptToken(input.refreshToken);
    const provider = input.provider ?? 'google';
    const data: Prisma.DirectoryAccountUncheckedCreateInput = {
      workspaceId: input.workspaceId,
      connectedByUserId: input.connectedByUserId,
      provider,
      domain: input.domain,
      accessToken: accessToken ?? null,
      refreshToken: refreshToken ?? null,
      expiresAt: input.expiresAt ?? null,
      scope: input.scope ?? null,
      status: input.status ?? 'active',
      lastError: input.lastError ?? null,
    };

    const updateData: Prisma.DirectoryAccountUncheckedUpdateInput = {
      connectedByUserId: data.connectedByUserId,
      domain: data.domain,
      expiresAt: data.expiresAt,
      scope: data.scope,
      status: data.status,
      lastError: data.lastError,
    };

    if (accessToken) {
      updateData.accessToken = accessToken;
    }
    if (refreshToken) {
      updateData.refreshToken = refreshToken;
    }

    return await this.db.directoryAccount.upsert({
      where: {
        workspaceId_provider: { workspaceId: input.workspaceId, provider },
      },
      create: data,
      update: updateData,
    });
  }

  async updateTokens(id: string, input: UpdateDirectoryAccountTokensInput) {
    const data: Prisma.DirectoryAccountUncheckedUpdateInput = {};
    if (input.accessToken !== undefined) {
      data.accessToken = this.encryptToken(input.accessToken);
    }
    if (input.refreshToken !== undefined) {
      data.refreshToken = this.encryptToken(input.refreshToken);
    }
    if (input.expiresAt !== undefined) {
      data.expiresAt = input.expiresAt ?? null;
    }
    if (input.scope !== undefined) {
      data.scope = input.scope ?? null;
    }
    if (input.status !== undefined) {
      data.status = input.status ?? undefined;
    }
    if (input.lastError !== undefined) {
      data.lastError = input.lastError ?? null;
    }

    return await this.db.directoryAccount.update({ where: { id }, data });
  }

  async updateStatus(id: string, status: string, lastError?: string | null) {
    return await this.db.directoryAccount.update({
      where: { id },
      data: { status, lastError: lastError ?? null },
    });
  }

  async touchLastSync(id: string) {
    return await this.db.directoryAccount.update({
      where: { id },
      data: { lastSyncAt: new Date() },
    });
  }

  async delete(id: string) {
    return await this.db.directoryAccount.delete({ where: { id } });
  }

  decryptTokens(account: DirectoryAccount) {
    return {
      ...account,
      accessToken: this.decryptToken(account.accessToken),
      refreshToken: this.decryptToken(account.refreshToken),
    };
  }
}

import { Injectable } from '@nestjs/common';
import type { DirectoryAccount } from '@prisma/client';
import { WorkspaceMemberSource, WorkspaceMemberStatus } from '@prisma/client';

import { GraphqlBadRequest, JobQueue, URLHelper } from '../../base';
import { WorkspaceRole } from '../../core/permission';
import { ProjectService } from '../../core/projects';
import { Models } from '../../models';
import {
  DirectoryProvider,
  DirectoryProviderFactory,
  DirectoryProviderName,
  DirectoryProviderUser,
} from './providers';

/** A synced user survives this many consecutive missed cycles before being de-provisioned. */
const MAX_MISSED_SYNC_CYCLES = 2;
/** Refresh the access token if it expires within this window. */
const TOKEN_REFRESH_SKEW_MS = 60_000;

export interface CreateSyncScopeInput {
  directoryAccountId: string;
  projectId: string;
  scopeType: 'group' | 'org_unit';
  externalId: string;
  label?: string | null;
}

@Injectable()
export class DirectoryService {
  constructor(
    private readonly models: Models,
    private readonly providerFactory: DirectoryProviderFactory<DirectoryProvider>,
    private readonly projects: ProjectService,
    private readonly queue: JobQueue,
    private readonly url: URLHelper
  ) {}

  isProviderAvailable(provider: DirectoryProviderName) {
    return this.providerFactory.providers.includes(provider);
  }

  getCallbackUrl() {
    return this.url.link('/api/directory/oauth/callback');
  }

  getAuthUrl(
    provider: DirectoryProviderName,
    state: string,
    redirectUri: string
  ) {
    return this.mustGetProvider(provider).getAuthUrl(state, redirectUri);
  }

  async handleOAuthCallback(params: {
    provider: DirectoryProviderName;
    code: string;
    redirectUri: string;
    workspaceId: string;
    connectedByUserId: string;
  }) {
    const provider = this.mustGetProvider(params.provider);
    const tokens = await provider.exchangeCode(
      params.code,
      params.redirectUri
    );
    const profile = await provider.getAccountProfile(tokens.accessToken);

    if (!profile.domain) {
      throw new GraphqlBadRequest({
        code: 'DIRECTORY_DOMAIN_NOT_FOUND',
        message:
          'Could not determine the Google Workspace domain for this account.',
      });
    }

    return await this.models.directoryAccount.upsert({
      workspaceId: params.workspaceId,
      connectedByUserId: params.connectedByUserId,
      provider: params.provider,
      domain: profile.domain,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
      status: 'active',
    });
  }

  async disconnectAccount(accountId: string) {
    const scopes = await this.models.directorySyncScope.listByAccount(
      accountId
    );
    for (const scope of scopes) {
      await this.deleteSyncScope(scope.id);
    }
    await this.models.directoryAccount.delete(accountId);
  }

  async listGroups(accountId: string) {
    const account = await this.mustGetAccount(accountId);
    const accessToken = await this.ensureAccessToken(account);
    const provider = this.mustGetProvider(
      account.provider as DirectoryProviderName
    );
    return await provider.listGroups({ accessToken, domain: account.domain });
  }

  async listOrgUnits(accountId: string) {
    const account = await this.mustGetAccount(accountId);
    const accessToken = await this.ensureAccessToken(account);
    const provider = this.mustGetProvider(
      account.provider as DirectoryProviderName
    );
    return await provider.listOrgUnits({ accessToken });
  }

  async createSyncScope(input: CreateSyncScopeInput) {
    const scope = await this.models.directorySyncScope.create(input);
    await this.enqueueSyncScope(scope.id);
    return scope;
  }

  async deleteSyncScope(scopeId: string) {
    const scope = await this.models.directorySyncScope.get(scopeId);
    if (!scope) {
      return;
    }

    const syncedUsers =
      await this.models.directorySyncedUser.listActiveByScope(scopeId);
    for (const synced of syncedUsers) {
      if (synced.workspaceUserId) {
        await this.projects
          .removeMember(scope.projectId, synced.workspaceUserId)
          .catch(() => {});
      }
    }

    await this.models.directorySyncScope.delete(scopeId);
  }

  enqueueSyncScope(scopeId: string) {
    return this.queue.add(
      'directory.syncScope',
      { scopeId },
      { jobId: scopeId }
    );
  }

  /**
   * Diffs a scope's live Google directory membership against what we last
   * synced, adding new members (workspace + Project) and — after
   * `MAX_MISSED_SYNC_CYCLES` consecutive absences, to ride out transient
   * Google API hiccups — de-provisioning ones that disappeared. The
   * workspace Owner and the admin who connected the integration are never
   * de-provisioned by this path, regardless of directory state.
   */
  async syncScope(scopeId: string) {
    const scope = await this.models.directorySyncScope.get(scopeId);
    if (!scope || scope.status !== 'active') {
      return;
    }

    const account = await this.models.directoryAccount.get(
      scope.directoryAccountId
    );
    if (!account || account.status !== 'active') {
      return;
    }

    try {
      const accessToken = await this.ensureAccessToken(account);
      const provider = this.mustGetProvider(
        account.provider as DirectoryProviderName
      );

      const externalUsers: DirectoryProviderUser[] =
        scope.scopeType === 'group'
          ? await provider.listGroupMembers({
              accessToken,
              groupKey: scope.externalId,
            })
          : await provider.listUsers({
              accessToken,
              domain: account.domain,
              orgUnitPath: scope.externalId,
            });

      const seenExternalIds = new Set(externalUsers.map(u => u.externalId));
      const owner = await this.models.workspaceUser
        .getOwner(account.workspaceId)
        .catch(() => null);
      const guardedUserIds = new Set(
        [owner?.id, account.connectedByUserId].filter(
          (id): id is string => !!id
        )
      );

      for (const externalUser of externalUsers) {
        const user = await this.resolveWorkspaceUser(
          account,
          externalUser.primaryEmail
        );
        await this.projects
          .addMember(scope.projectId, user.id, 'member')
          .catch(() => {});
        await this.models.directorySyncedUser.markSeen(
          scopeId,
          externalUser.externalId,
          externalUser.primaryEmail,
          user.id
        );
      }

      const previouslySynced =
        await this.models.directorySyncedUser.listActiveByScope(scopeId);
      for (const synced of previouslySynced) {
        if (seenExternalIds.has(synced.externalUserId)) {
          continue;
        }
        if (
          synced.workspaceUserId &&
          guardedUserIds.has(synced.workspaceUserId)
        ) {
          continue;
        }

        const updated = await this.models.directorySyncedUser.incrementMissed(
          scopeId,
          synced.externalUserId
        );
        if (updated.missedSyncCount >= MAX_MISSED_SYNC_CYCLES) {
          if (updated.workspaceUserId) {
            await this.projects
              .removeMember(scope.projectId, updated.workspaceUserId)
              .catch(() => {});
            await this.models.workspaceUser
              .delete(account.workspaceId, updated.workspaceUserId)
              .catch(() => {});
          }
          await this.models.directorySyncedUser.markRemoved(
            scopeId,
            synced.externalUserId
          );
        }
      }

      await this.models.directorySyncScope.touchSync(scopeId);
      await this.models.directoryAccount.touchLastSync(account.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.models.directorySyncScope.touchSync(scopeId, message);
      throw error;
    }
  }

  private async resolveWorkspaceUser(
    account: DirectoryAccount,
    email: string
  ) {
    let user = await this.models.user.getUserByEmail(email);
    if (!user) {
      user = await this.models.user.create({ email, registered: false });
    }

    const existingRole = await this.models.workspaceUser.get(
      account.workspaceId,
      user.id
    );
    if (!existingRole) {
      await this.models.workspaceUser.set(
        account.workspaceId,
        user.id,
        WorkspaceRole.Collaborator,
        {
          status: WorkspaceMemberStatus.Accepted,
          source: WorkspaceMemberSource.Email,
          inviterId: account.connectedByUserId,
        }
      );
    }

    return user;
  }

  private async ensureAccessToken(account: DirectoryAccount) {
    const decrypted = this.models.directoryAccount.decryptTokens(account);
    if (!decrypted.accessToken) {
      throw new GraphqlBadRequest({
        code: 'DIRECTORY_ACCOUNT_NOT_AUTHORIZED',
        message: 'Directory account is missing an access token.',
      });
    }

    const stillValid =
      account.expiresAt &&
      account.expiresAt.getTime() - Date.now() > TOKEN_REFRESH_SKEW_MS;
    if (stillValid || !decrypted.refreshToken) {
      return decrypted.accessToken;
    }

    const provider = this.mustGetProvider(
      account.provider as DirectoryProviderName
    );
    const refreshed = await provider.refreshTokens(decrypted.refreshToken);
    await this.models.directoryAccount.updateTokens(account.id, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? decrypted.refreshToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope,
    });
    return refreshed.accessToken;
  }

  private async mustGetAccount(accountId: string) {
    const account = await this.models.directoryAccount.get(accountId);
    if (!account) {
      throw new GraphqlBadRequest({
        code: 'DIRECTORY_ACCOUNT_NOT_FOUND',
        message: `Directory account ${accountId} not found.`,
      });
    }
    return account;
  }

  private mustGetProvider(name: DirectoryProviderName) {
    const provider = this.providerFactory.get(name);
    if (!provider) {
      throw new GraphqlBadRequest({
        code: 'DIRECTORY_PROVIDER_NOT_CONFIGURED',
        message: `Directory provider ${name} is not configured.`,
      });
    }
    return provider;
  }
}

import {
  Args,
  Int,
  Mutation,
  Parent,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';

import {
  GraphqlBadRequest,
  UnknownOauthProvider,
} from '../../base';
import { CurrentUser } from '../../core/auth';
import { PermissionAccess } from '../../core/permission';
import { WorkspaceType } from '../../core/workspaces';
import { Models } from '../../models';
import { DirectoryOAuthService } from './oauth';
import { DirectoryProviderFactory } from './providers';
import { DirectoryService } from './service';
import {
  ConnectDirectoryAccountInput,
  CreateDirectorySyncScopeInput,
  DirectoryAccountObjectType,
  DirectoryGroupObjectType,
  DirectoryOrgUnitObjectType,
  DirectorySyncScopeObjectType,
} from './types';

@Resolver(() => WorkspaceType)
export class WorkspaceDirectoryResolver {
  constructor(
    private readonly models: Models,
    private readonly access: PermissionAccess
  ) {}

  @ResolveField(() => DirectoryAccountObjectType, { nullable: true })
  async directoryAccount(
    @CurrentUser() user: CurrentUser,
    @Parent() workspace: WorkspaceType
  ) {
    await this.access
      .user(user.id)
      .workspace(workspace.id)
      .assert('Workspace.Users.Manage');
    return await this.models.directoryAccount.getByWorkspace(workspace.id);
  }
}

@Resolver(() => DirectoryAccountObjectType)
export class DirectoryAccountResolver {
  constructor(
    private readonly directory: DirectoryService,
    private readonly models: Models
  ) {}

  @ResolveField(() => [DirectorySyncScopeObjectType])
  async syncScopes(@Parent() account: DirectoryAccountObjectType) {
    return await this.models.directorySyncScope.listByAccount(account.id);
  }

  @ResolveField(() => [DirectoryGroupObjectType])
  async availableGroups(@Parent() account: DirectoryAccountObjectType) {
    return await this.directory.listGroups(account.id);
  }

  @ResolveField(() => [DirectoryOrgUnitObjectType])
  async availableOrgUnits(@Parent() account: DirectoryAccountObjectType) {
    return await this.directory.listOrgUnits(account.id);
  }
}

@Resolver(() => DirectorySyncScopeObjectType)
export class DirectorySyncScopeResolver {
  constructor(private readonly models: Models) {}

  @ResolveField(() => Int)
  async memberCount(@Parent() scope: DirectorySyncScopeObjectType) {
    const synced = await this.models.directorySyncedUser.listActiveByScope(
      scope.id
    );
    return synced.length;
  }
}

@Resolver(() => DirectoryAccountObjectType)
export class DirectoryMutationResolver {
  constructor(
    private readonly directory: DirectoryService,
    private readonly models: Models,
    private readonly access: PermissionAccess,
    private readonly oauth: DirectoryOAuthService,
    private readonly providerFactory: DirectoryProviderFactory
  ) {}

  @Mutation(() => String)
  async connectDirectoryAccount(
    @CurrentUser() user: CurrentUser,
    @Args('input') input: ConnectDirectoryAccountInput
  ) {
    await this.access
      .user(user.id)
      .workspace(input.workspaceId)
      .assert('Workspace.Users.Manage');

    if (!this.providerFactory.providers.includes(input.provider)) {
      throw new UnknownOauthProvider({ name: input.provider });
    }

    const state = await this.oauth.saveOAuthState({
      provider: input.provider,
      workspaceId: input.workspaceId,
      userId: user.id,
      redirectUri: input.redirectUri ?? undefined,
    });

    const callbackUrl = this.directory.getCallbackUrl();
    return this.directory.getAuthUrl(input.provider, state, callbackUrl);
  }

  @Mutation(() => Boolean)
  async disconnectDirectoryAccount(
    @CurrentUser() user: CurrentUser,
    @Args('accountId') accountId: string
  ) {
    const account = await this.mustGetAccount(accountId);
    await this.access
      .user(user.id)
      .workspace(account.workspaceId)
      .assert('Workspace.Users.Manage');
    await this.directory.disconnectAccount(accountId);
    return true;
  }

  @Mutation(() => DirectorySyncScopeObjectType)
  async createDirectorySyncScope(
    @CurrentUser() user: CurrentUser,
    @Args('input') input: CreateDirectorySyncScopeInput
  ) {
    const account = await this.mustGetAccount(input.directoryAccountId);
    await this.access
      .user(user.id)
      .workspace(account.workspaceId)
      .assert('Workspace.Users.Manage');
    if (input.scopeType !== 'group' && input.scopeType !== 'org_unit') {
      throw new GraphqlBadRequest({
        code: 'DIRECTORY_INVALID_SCOPE_TYPE',
        message: `Invalid scope type: ${input.scopeType}`,
      });
    }
    return await this.directory.createSyncScope({
      directoryAccountId: input.directoryAccountId,
      projectId: input.projectId,
      scopeType: input.scopeType,
      externalId: input.externalId,
      label: input.label,
    });
  }

  @Mutation(() => Boolean)
  async deleteDirectorySyncScope(
    @CurrentUser() user: CurrentUser,
    @Args('scopeId') scopeId: string
  ) {
    const scope = await this.mustGetScope(scopeId);
    const account = await this.mustGetAccount(scope.directoryAccountId);
    await this.access
      .user(user.id)
      .workspace(account.workspaceId)
      .assert('Workspace.Users.Manage');
    await this.directory.deleteSyncScope(scopeId);
    return true;
  }

  @Mutation(() => Boolean)
  async syncDirectoryScopeNow(
    @CurrentUser() user: CurrentUser,
    @Args('scopeId') scopeId: string
  ) {
    const scope = await this.mustGetScope(scopeId);
    const account = await this.mustGetAccount(scope.directoryAccountId);
    await this.access
      .user(user.id)
      .workspace(account.workspaceId)
      .assert('Workspace.Users.Manage');
    await this.directory.enqueueSyncScope(scopeId);
    return true;
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

  private async mustGetScope(scopeId: string) {
    const scope = await this.models.directorySyncScope.get(scopeId);
    if (!scope) {
      throw new GraphqlBadRequest({
        code: 'DIRECTORY_SCOPE_NOT_FOUND',
        message: `Directory sync scope ${scopeId} not found.`,
      });
    }
    return scope;
  }
}

import {
  type ConnectDirectoryAccountInput,
  connectDirectoryAccountMutation,
  type CreateDirectorySyncScopeInput,
  createDirectorySyncScopeMutation,
  deleteDirectorySyncScopeMutation,
  directoryAvailableGroupsQuery,
  directoryAvailableOrgUnitsQuery,
  disconnectDirectoryAccountMutation,
  syncDirectoryScopeNowMutation,
  workspaceDirectoryAccountQuery,
} from '@notesgraph/graphql';
import { Store } from '@notesgraph/infra';

import type { WorkspaceServerService } from '../../cloud';

export class DirectoryStore extends Store {
  constructor(private readonly workspaceServerService: WorkspaceServerService) {
    super();
  }

  private get server() {
    const server = this.workspaceServerService.server;
    if (!server) {
      throw new Error('No Server');
    }
    return server;
  }

  async getDirectoryAccount(workspaceId: string, signal?: AbortSignal) {
    const data = await this.server.gql({
      query: workspaceDirectoryAccountQuery,
      variables: { workspaceId },
      context: { signal },
    });
    return data.workspace.directoryAccount;
  }

  async connectDirectoryAccount(input: ConnectDirectoryAccountInput) {
    const data = await this.server.gql({
      query: connectDirectoryAccountMutation,
      variables: { input },
    });
    return data.connectDirectoryAccount;
  }

  async disconnectDirectoryAccount(accountId: string) {
    const data = await this.server.gql({
      query: disconnectDirectoryAccountMutation,
      variables: { accountId },
    });
    return data.disconnectDirectoryAccount;
  }

  async listAvailableGroups(workspaceId: string) {
    const data = await this.server.gql({
      query: directoryAvailableGroupsQuery,
      variables: { workspaceId },
    });
    return data.workspace.directoryAccount?.availableGroups ?? [];
  }

  async listAvailableOrgUnits(workspaceId: string) {
    const data = await this.server.gql({
      query: directoryAvailableOrgUnitsQuery,
      variables: { workspaceId },
    });
    return data.workspace.directoryAccount?.availableOrgUnits ?? [];
  }

  async createSyncScope(input: CreateDirectorySyncScopeInput) {
    const data = await this.server.gql({
      query: createDirectorySyncScopeMutation,
      variables: { input },
    });
    return data.createDirectorySyncScope;
  }

  async deleteSyncScope(scopeId: string) {
    const data = await this.server.gql({
      query: deleteDirectorySyncScopeMutation,
      variables: { scopeId },
    });
    return data.deleteDirectorySyncScope;
  }

  async syncScopeNow(scopeId: string) {
    const data = await this.server.gql({
      query: syncDirectoryScopeNowMutation,
      variables: { scopeId },
    });
    return data.syncDirectoryScopeNow;
  }
}

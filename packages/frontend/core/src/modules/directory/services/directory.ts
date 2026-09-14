import type { DirectoryProviderType } from '@notesgraph/graphql';
import { Service } from '@notesgraph/infra';

import type { WorkspaceService } from '../../workspace';
import { Directory } from '../entities/directory';
import type { DirectoryStore } from '../stores/directory';

export class DirectoryService extends Service {
  constructor(
    private readonly store: DirectoryStore,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
  }

  directory = this.framework.createEntity(Directory);

  async connectAccount(
    provider: DirectoryProviderType,
    redirectUri?: string
  ) {
    return await this.store.connectDirectoryAccount({
      workspaceId: this.workspaceService.workspace.id,
      provider,
      redirectUri,
    });
  }

  async disconnectAccount(accountId: string) {
    await this.store.disconnectDirectoryAccount(accountId);
    await this.directory.revalidate();
  }

  async listAvailableGroups() {
    return await this.store.listAvailableGroups(
      this.workspaceService.workspace.id
    );
  }

  async listAvailableOrgUnits() {
    return await this.store.listAvailableOrgUnits(
      this.workspaceService.workspace.id
    );
  }

  async createSyncScope(input: {
    directoryAccountId: string;
    projectId: string;
    scopeType: 'group' | 'org_unit';
    externalId: string;
    label?: string | null;
  }) {
    const scope = await this.store.createSyncScope(input);
    await this.directory.revalidate();
    return scope;
  }

  async deleteSyncScope(scopeId: string) {
    await this.store.deleteSyncScope(scopeId);
    await this.directory.revalidate();
  }

  async syncScopeNow(scopeId: string) {
    await this.store.syncScopeNow(scopeId);
    await this.directory.revalidate();
  }
}

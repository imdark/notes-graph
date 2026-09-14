import type { WorkspaceDirectoryAccountQuery } from '@notesgraph/graphql';
import { Entity, LiveData } from '@notesgraph/infra';

import type { WorkspaceService } from '../../workspace';
import type { DirectoryStore } from '../stores/directory';

export type DirectoryAccount = NonNullable<
  WorkspaceDirectoryAccountQuery['workspace']['directoryAccount']
>;

export class Directory extends Entity {
  constructor(
    private readonly store: DirectoryStore,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
    this.revalidate().catch(err => this.error$.setValue(err));
  }

  account$ = new LiveData<DirectoryAccount | null | undefined>(undefined);
  isLoading$ = new LiveData(false);
  error$ = new LiveData<unknown>(null);

  revalidate = async () => {
    this.isLoading$.setValue(true);
    try {
      const account = await this.store.getDirectoryAccount(
        this.workspaceService.workspace.id
      );
      this.account$.setValue(account ?? null);
      this.error$.setValue(null);
    } catch (err) {
      this.error$.setValue(err);
    } finally {
      this.isLoading$.setValue(false);
    }
  };
}

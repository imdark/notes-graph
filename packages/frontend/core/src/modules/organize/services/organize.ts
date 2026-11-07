import { LiveData, Service } from '@notesgraph/infra';

import { FolderTree } from '../entities/folder-tree';
import type { FolderStore } from '../stores/folder';

export class OrganizeService extends Service {
  constructor(private readonly folderStore: FolderStore) {
    super();
  }

  folderTree = this.framework.createEntity(FolderTree);

  /** Docs filed under `ai / conversations`: agent run transcripts. */
  conversationDocIds$ = LiveData.from(
    this.folderStore.watchConversationDocIds(),
    [] as string[]
  );
}

export {
  type FolderSyncState,
  FolderSyncService,
} from './services/folder-sync';
export {
  type FolderBinding,
  type FolderSyncEntry,
  FolderSyncStore,
} from './stores/folder-sync-store';
export {
  hasNativeFileObserver,
  isFolderSyncSupported,
} from './utils/fs-access';

import { type Framework } from '@notesgraph/infra';

import { DocsService } from '../doc';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { FolderSyncService } from './services/folder-sync';
import { FolderSyncStore } from './stores/folder-sync-store';

export function configureFolderSyncModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(FolderSyncService, [
      FolderSyncStore,
      WorkspaceService,
      DocsService,
    ])
    .store(FolderSyncStore);
}

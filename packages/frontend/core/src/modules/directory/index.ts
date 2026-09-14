export type { DirectoryAccount } from './entities/directory';
export { Directory } from './entities/directory';
export { DirectoryService } from './services/directory';

import { type Framework } from '@notesgraph/infra';

import { WorkspaceServerService } from '../cloud/services/workspace-server';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { Directory } from './entities/directory';
import { DirectoryService } from './services/directory';
import { DirectoryStore } from './stores/directory';

export function configureDirectoryModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(DirectoryService, [DirectoryStore, WorkspaceService])
    .store(DirectoryStore, [WorkspaceServerService])
    .entity(Directory, [DirectoryStore, WorkspaceService]);
}

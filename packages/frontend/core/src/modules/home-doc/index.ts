import { type Framework } from '@notesgraph/infra';

import { DocsService } from '../doc';
import { GlobalStateService } from '../storage';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { HomeDocService } from './services/home-doc';

export { HomeDocService } from './services/home-doc';

export function configureHomeDocModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(HomeDocService, [
      GlobalStateService,
      DocsService,
      WorkspaceService,
    ]);
}

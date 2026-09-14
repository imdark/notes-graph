export type { Project } from './entities/projects';
export { Projects } from './entities/projects';
export { ProjectsService } from './services/projects';

import { type Framework } from '@notesgraph/infra';

import { WorkspaceServerService } from '../cloud/services/workspace-server';
import { WorkspaceDBService } from '../db';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { Projects } from './entities/projects';
import { ProjectsService } from './services/projects';
import { ProjectsStore } from './stores/projects';

export function configureProjectsModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(ProjectsService, [ProjectsStore, WorkspaceService])
    .store(ProjectsStore, [
      WorkspaceServerService,
      WorkspaceDBService,
      WorkspaceService,
    ])
    .entity(Projects, [ProjectsStore, WorkspaceService]);
}

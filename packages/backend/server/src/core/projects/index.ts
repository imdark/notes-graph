import { Module } from '@nestjs/common';

import { PermissionModule } from '../permission';
import { ProjectResolver, WorkspaceProjectsResolver } from './resolvers/project';
import { ProjectService } from './service';

@Module({
  imports: [PermissionModule],
  providers: [ProjectService, ProjectResolver, WorkspaceProjectsResolver],
  exports: [ProjectService],
})
export class ProjectModule {}

export { ProjectService } from './service';
export * from './types';

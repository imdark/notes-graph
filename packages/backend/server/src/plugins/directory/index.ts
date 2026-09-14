import './config';

import { Module } from '@nestjs/common';

import { AuthModule } from '../../core/auth';
import { PermissionModule } from '../../core/permission';
import { ProjectModule } from '../../core/projects';
import { WorkspaceModule } from '../../core/workspaces';
import { DirectoryController } from './controller';
import { DirectoryCronJobs } from './cron';
import { DirectoryJob } from './job';
import { DirectoryOAuthService } from './oauth';
import { DirectoryProviderFactory, DirectoryProviders } from './providers';
import {
  DirectoryAccountResolver,
  DirectoryMutationResolver,
  DirectorySyncScopeResolver,
  WorkspaceDirectoryResolver,
} from './resolver';
import { DirectoryService } from './service';

@Module({
  imports: [AuthModule, PermissionModule, WorkspaceModule, ProjectModule],
  providers: [
    ...DirectoryProviders,
    DirectoryProviderFactory,
    DirectoryService,
    DirectoryJob,
    DirectoryOAuthService,
    DirectoryCronJobs,
    WorkspaceDirectoryResolver,
    DirectoryAccountResolver,
    DirectorySyncScopeResolver,
    DirectoryMutationResolver,
  ],
  controllers: [DirectoryController],
})
export class DirectoryModule {}

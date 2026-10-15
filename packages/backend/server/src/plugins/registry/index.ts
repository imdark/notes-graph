import './config';

import { Module } from '@nestjs/common';

import { AuthModule } from '../../core/auth';
import { DocStorageModule } from '../../core/doc';
import { PermissionModule } from '../../core/permission';
import { WorkspaceModule } from '../../core/workspaces';
import { RegistryController } from './controller';
import { RegistryHealthService } from './health';
import { RegistryJobService } from './jobs';
import { MonitoringAgentService } from './monitoring-agent';
import { AgentPushService } from './push';
import { RegistryService } from './service';
import { RegistryJobShareController, RegistryJobShareService } from './share';
import { JobTaskClaims } from './task-claims';

/**
 * Device registry: machines and folders registered as deployment and
 * agent-execution targets, written by external tooling over a PAT-
 * authenticated REST API. Health checks run on them as device jobs, and the
 * monitoring agent learns from what they report.
 */
@Module({
  imports: [AuthModule, DocStorageModule, PermissionModule, WorkspaceModule],
  providers: [
    RegistryService,
    RegistryJobService,
    RegistryHealthService,
    MonitoringAgentService,
    AgentPushService,
    JobTaskClaims,
    RegistryJobShareService,
  ],
  controllers: [RegistryController, RegistryJobShareController],
  // Monitors queue device jobs and push alerts through these.
  exports: [RegistryJobService, AgentPushService],
})
export class RegistryModule {}

export { RegistryJobService } from './jobs';
export { AgentPushService } from './push';
export { RegistryService } from './service';
export * from './jobs';
export * from './types';

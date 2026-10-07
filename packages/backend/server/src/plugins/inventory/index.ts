import './config';

import { Module } from '@nestjs/common';

import { AuthModule } from '../../core/auth';
import { DocStorageModule } from '../../core/doc';
import { PermissionModule } from '../../core/permission';
import { WorkspaceModule } from '../../core/workspaces';
import { InventoryController } from './controller';
import { InventoryHealthService } from './health';
import { InventoryJobService } from './jobs';
import { MonitoringAgentService } from './monitoring-agent';
import { AgentPushService } from './push';
import { InventoryService } from './service';
import { JobTaskClaims } from './task-claims';

/**
 * Device inventory: machines and folders registered as deployment and
 * agent-execution targets, written by external tooling over a PAT-
 * authenticated REST API. Health checks run on them as device jobs, and the
 * monitoring agent learns from what they report.
 */
@Module({
  imports: [AuthModule, DocStorageModule, PermissionModule, WorkspaceModule],
  providers: [
    InventoryService,
    InventoryJobService,
    InventoryHealthService,
    MonitoringAgentService,
    AgentPushService,
    JobTaskClaims,
  ],
  controllers: [InventoryController],
  // Monitors queue device jobs and push alerts through these.
  exports: [InventoryJobService, AgentPushService],
})
export class InventoryModule {}

export { InventoryJobService } from './jobs';
export { AgentPushService } from './push';
export { InventoryService } from './service';
export * from './jobs';
export * from './types';

import './config';

import { Module } from '@nestjs/common';

import { AuthModule } from '../../core/auth';
import { PermissionModule } from '../../core/permission';
import { WorkspaceModule } from '../../core/workspaces';
import { InventoryController } from './controller';
import { InventoryJobService } from './jobs';
import { AgentPushService } from './push';
import { InventoryService } from './service';

/**
 * Device inventory: machines and folders registered as deployment and
 * agent-execution targets, written by external tooling over a PAT-
 * authenticated REST API.
 */
@Module({
  imports: [AuthModule, PermissionModule, WorkspaceModule],
  providers: [InventoryService, InventoryJobService, AgentPushService],
  controllers: [InventoryController],
})
export class InventoryModule {}

export { InventoryJobService } from './jobs';
export { InventoryService } from './service';
export * from './jobs';
export * from './types';

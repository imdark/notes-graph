import { Module } from '@nestjs/common';

import { PermissionModule } from '../permission';
import { AgentPluginsController } from './controller';

@Module({
  imports: [PermissionModule],
  controllers: [AgentPluginsController],
})
export class AgentPluginsModule {}

export { agentPluginBaseUrl } from './controller';

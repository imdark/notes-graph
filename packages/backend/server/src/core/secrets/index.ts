import { Module } from '@nestjs/common';

import { PermissionModule } from '../permission';
import { WorkspaceSecretResolver } from './resolver';

@Module({
  imports: [PermissionModule],
  providers: [WorkspaceSecretResolver],
})
export class SecretsModule {}

import './config';

import { Module } from '@nestjs/common';

import { DeployInfoController } from './deploy-info';
import {
  AppConfigResolver,
  ServerConfigResolver,
  ServerFeatureConfigResolver,
} from './resolver';
import { ServerService } from './service';

@Module({
  providers: [ServerService],
  exports: [ServerService],
})
export class ServerConfigModule {}
@Module({
  imports: [ServerConfigModule],
  providers: [
    ServerConfigResolver,
    ServerFeatureConfigResolver,
    AppConfigResolver,
  ],
  controllers: [DeployInfoController],
})
export class ServerConfigResolverModule {}
export type { DeployInfo } from './deploy-info';
export { ServerService };
export { ServerFeature } from './types';

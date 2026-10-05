import './config';

import { Module } from '@nestjs/common';

import { PermissionModule } from '../../core/permission';
import { ResearchController } from './controller';
import { OmniSeekClient } from './omniseek';

/**
 * Research harness support: OmniSeek's search and reading tools, proxied
 * from a sidecar for agent runs in the browser. Off until
 * NOTESGRAPH_OMNISEEK_URL is set.
 */
@Module({
  imports: [PermissionModule],
  providers: [OmniSeekClient],
  controllers: [ResearchController],
})
export class ResearchModule {}

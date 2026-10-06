import './config';

import { Module } from '@nestjs/common';

import { PermissionModule } from '../../core/permission';
import { ResearchController } from './controller';
import { DeepSeekClient } from './deepseek';
import { DeepSeekController } from './deepseek-controller';
import { OmniSeekClient } from './omniseek';

/**
 * Research harness support: OmniSeek's search and reading tools, proxied
 * from a sidecar for agent runs in the browser, off until
 * NOTESGRAPH_OMNISEEK_URL is set; and DeepSeek as a model for those runs,
 * off until NOTESGRAPH_DEEPSEEK_API_KEY is set.
 */
@Module({
  imports: [PermissionModule],
  providers: [OmniSeekClient, DeepSeekClient],
  controllers: [ResearchController, DeepSeekController],
})
export class ResearchModule {}

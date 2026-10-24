import { Module } from '@nestjs/common';

import { PermissionModule } from '../../core/permission';
import { RegistryModule } from '../registry';
import {
  AutomationController,
  AutomationWebhookController,
} from './controller';
import { AutomationCronJobs } from './cron';
import { AutomationService } from './service';

/**
 * Automations: code that runs on a device when a schedule, a workspace event,
 * a webhook or a click says so. The device's runner executes it as a
 * registry job of kind 'automation'.
 */
@Module({
  imports: [PermissionModule, RegistryModule],
  providers: [AutomationService, AutomationCronJobs],
  controllers: [AutomationController, AutomationWebhookController],
})
export class AutomationsModule {}

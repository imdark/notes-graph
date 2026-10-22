import { Module } from '@nestjs/common';

import { DocStorageModule } from '../../core/doc';
import { NotificationModule } from '../../core/notification';
import { PermissionModule } from '../../core/permission';
import { RegistryModule } from '../registry';
import { MonitorController } from './controller';
import { MonitorCronJobs } from './cron';
import { MonitorService } from './service';

/**
 * Monitors: watch a website, a command on a device, or run an agent on a
 * schedule, and keep a note block up to date with what they find.
 */
@Module({
  imports: [
    DocStorageModule,
    NotificationModule,
    PermissionModule,
    RegistryModule,
  ],
  providers: [MonitorService, MonitorCronJobs],
  controllers: [MonitorController],
})
export class BlockMonitorModule {}

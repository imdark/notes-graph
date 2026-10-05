import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Models } from '../../models';
import { MonitorService } from './service';

const MONITOR_POLL_BATCH_SIZE = 200;

/**
 * Every minute, queue the monitors that are due. The job id is the monitor's,
 * so a monitor already queued or running isn't queued twice.
 */
@Injectable()
export class MonitorCronJobs {
  constructor(
    private readonly models: Models,
    private readonly monitors: MonitorService
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async pollMonitors() {
    const due = await this.models.monitor.listDue(
      new Date(),
      MONITOR_POLL_BATCH_SIZE
    );
    await Promise.allSettled(due.map(({ id }) => this.monitors.schedule(id)));
  }
}

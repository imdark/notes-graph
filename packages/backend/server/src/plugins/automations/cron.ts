import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Models } from '../../models';
import { AutomationService } from './service';

const AUTOMATION_POLL_BATCH_SIZE = 200;

/**
 * Every minute, start the automations whose schedule is due. Each books its
 * next run before starting, so one tick never starts it twice.
 */
@Injectable()
export class AutomationCronJobs {
  private readonly logger = new Logger(AutomationCronJobs.name);

  constructor(
    private readonly models: Models,
    private readonly automations: AutomationService
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async pollAutomations() {
    const now = new Date();
    const due = await this.models.automation.listDue(
      now,
      AUTOMATION_POLL_BATCH_SIZE
    );
    const results = await Promise.allSettled(
      due.map(automation => this.automations.runScheduled(automation, now))
    );
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        this.logger.warn(
          `automation ${due[i].id}: ${(result.reason as Error).message}`
        );
      }
    });
  }
}

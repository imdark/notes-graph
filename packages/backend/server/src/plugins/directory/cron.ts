import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Models } from '../../models';
import { DirectoryService } from './service';

@Injectable()
export class DirectoryCronJobs {
  constructor(
    private readonly models: Models,
    private readonly directory: DirectoryService
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async pollScopes() {
    const scopes = await this.models.directorySyncScope.listDue();
    await Promise.allSettled(
      scopes.map(({ id }) => this.directory.enqueueSyncScope(id))
    );
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { RegistryDeployRepo } from '@prisma/client';

import { Config } from '../../../base';
import { Models } from '../../../models';
import { ReleaseService } from './service';

/**
 * Every minute, for each workspace's release repo that has a token: refresh
 * the cached release state while a deploy runs, and move linked tasks on as
 * their pull requests merge and go live — releases started from the CLI
 * (scripts/release.sh) included.
 */
@Injectable()
export class ReleaseCronJobs {
  private readonly logger = new Logger(ReleaseCronJobs.name);
  private running = false;

  constructor(
    private readonly config: Config,
    private readonly models: Models,
    private readonly releases: ReleaseService
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async syncReleases() {
    if (!this.config.registry.enabled || this.running) return;
    this.running = true;
    try {
      const rows = await this.models.registryJob.listAllDeployRepos();
      await Promise.allSettled(
        releaseRows(rows).map(row =>
          this.releases.syncRepo(row).catch(err => {
            this.logger.warn(
              `releases: sync of ${row.repo} in ${row.workspaceId} failed: ${(err as Error).message}`
            );
          })
        )
      );
    } finally {
      this.running = false;
    }
  }
}

/** Each workspace's release repo: its most recently set (one per workspace). */
export function releaseRows(rows: RegistryDeployRepo[]): RegistryDeployRepo[] {
  const byWorkspace = new Map<string, RegistryDeployRepo>();
  for (const row of rows) {
    const kept = byWorkspace.get(row.workspaceId);
    if (!kept || row.updatedAt.getTime() > kept.updatedAt.getTime()) {
      byWorkspace.set(row.workspaceId, row);
    }
  }
  return [...byWorkspace.values()];
}

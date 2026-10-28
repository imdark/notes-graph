import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Controller, Get } from '@nestjs/common';

/**
 * What the running build was deployed from, written by
 * scripts/prod/redeploy.sh as `deploy-info.json` beside the server's
 * package.json. Lets the Deployments screen tell a merged pull request that is
 * live from one still waiting on a deploy.
 */
export interface DeployInfo {
  /** owner/name of the GitHub repo deployed, as in its pull request URLs. */
  repo: string;
  commit: string;
  branch: string;
  subject: string;
  /** The synced tree had uncommitted changes on top of `commit`. */
  dirty: boolean;
  deployedAt: string;
  /** Pull requests merged into `commit` (newest first, bounded). */
  pullRequests: number[];
  /**
   * The app's feature flags in this build, by the commit that added each.
   * Missing on records from before flags were stamped.
   */
  featureFlags?: Record<string, string>;
}

const DEPLOY_INFO_FILE = 'deploy-info.json';

const isDeployInfo = (value: any): value is DeployInfo =>
  !!value &&
  typeof value.commit === 'string' &&
  typeof value.deployedAt === 'string' &&
  Array.isArray(value.pullRequests);

@Controller('/api/server')
export class DeployInfoController {
  // Fixed for the life of the process: a deploy replaces the container.
  private info: Promise<DeployInfo | null> | null = null;

  /** Null on a build that wasn't deployed with a record (dev, self-hosted). */
  @Get('/deploy-info')
  async deployInfo(): Promise<{ deployInfo: DeployInfo | null }> {
    this.info ??= readFile(join(process.cwd(), DEPLOY_INFO_FILE), 'utf8')
      .then(text => {
        const parsed = JSON.parse(text);
        return isDeployInfo(parsed) ? parsed : null;
      })
      .catch(() => null);
    return { deployInfo: await this.info };
  }
}

import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { Config } from '../../../base';
import type { CurrentUser as CurrentUserType } from '../../../core/auth';
import { CurrentUser } from '../../../core/auth';
import { PermissionAccess } from '../../../core/permission';
import { ReleaseService } from './service';

/**
 * The Deployments screen's releases: read with workspace read, acted on with
 * settings update (as the deploy-repos routes), on the registry's paths.
 */
@Controller(['/api/registry/workspaces/:workspaceId/releases'])
export class ReleaseController {
  constructor(
    private readonly ac: PermissionAccess,
    private readonly config: Config,
    private readonly releases: ReleaseService
  ) {}

  private assertEnabled() {
    if (!this.config.registry.enabled) {
      throw new NotFoundException('Registry API is not enabled on this server');
    }
  }

  private async canRead(user: CurrentUserType, workspaceId: string) {
    this.assertEnabled();
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
  }

  private async canAct(user: CurrentUserType, workspaceId: string) {
    this.assertEnabled();
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
  }

  @Get('/')
  async state(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Query('fresh') fresh?: string
  ) {
    await this.canRead(user, workspaceId);
    return {
      state: await this.releases.state(workspaceId, {
        fresh: fresh === '1' || fresh === 'true',
      }),
    };
  }

  @Get('/settings')
  async getSettings(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string
  ) {
    await this.canRead(user, workspaceId);
    return { settings: await this.releases.settings(workspaceId) };
  }

  @Post('/settings')
  async setSettings(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Record<string, unknown>
  ) {
    await this.canAct(user, workspaceId);
    // The screen reads the state again itself.
    return {
      settings: await this.releases.setSettings(
        workspaceId,
        user.id,
        body ?? {}
      ),
    };
  }

  @Post('/settings/test')
  async testToken(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string
  ) {
    await this.canAct(user, workspaceId);
    return this.releases.testToken(workspaceId);
  }

  @Post('/merge')
  async merge(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Record<string, unknown>
  ) {
    await this.canAct(user, workspaceId);
    return this.releases.merge(workspaceId, body ?? {});
  }

  @Post('/merge-all')
  async mergeAll(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Record<string, unknown>
  ) {
    await this.canAct(user, workspaceId);
    return this.releases.mergeAll(workspaceId, body ?? {});
  }

  @Post('/release')
  async release(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Record<string, unknown>
  ) {
    await this.canAct(user, workspaceId);
    return this.releases.release(workspaceId, body ?? {});
  }

  @Post('/redeploy')
  async redeploy(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string
  ) {
    await this.canAct(user, workspaceId);
    return this.releases.redeploy(workspaceId);
  }

  @Post('/rollback')
  async rollback(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Record<string, unknown>
  ) {
    await this.canAct(user, workspaceId);
    return this.releases.rollback(workspaceId, body ?? {});
  }

  /** Build the Android APK from `ref` ({ref?, force?}) and publish it. */
  @Post('/apk')
  async buildApk(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Record<string, unknown>
  ) {
    await this.canAct(user, workspaceId);
    return this.releases.buildApk(workspaceId, body ?? {});
  }

  @Post('/retry')
  async retry(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Record<string, unknown>
  ) {
    await this.canAct(user, workspaceId);
    return this.releases.retry(workspaceId, body ?? {});
  }
}

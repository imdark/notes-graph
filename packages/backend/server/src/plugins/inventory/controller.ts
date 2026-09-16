import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { Config } from '../../base';
import type { CurrentUser as CurrentUserType } from '../../core/auth';
import { CurrentUser } from '../../core/auth';
import { PermissionAccess } from '../../core/permission';
import { Models } from '../../models';
import { InventoryService } from './service';
import type { DeviceStatusBody, RegisterDeviceBody } from './types';

/**
 * Device inventory API for deployment and agent-execution targets.
 *
 * Authenticated with a Personal Access Token, the same way the notes API is
 * (`/api/notes`), so external tooling such as the `wf` CLI can register a
 * machine without a browser session. Reads need workspace read; writes need
 * settings update, which keeps a viewer from rewriting the fleet.
 */
@Controller('/api/inventory')
export class InventoryController {
  constructor(
    private readonly ac: PermissionAccess,
    private readonly models: Models,
    private readonly service: InventoryService,
    private readonly config: Config
  ) {}

  private assertEnabled() {
    if (!this.config.inventory.enabled) {
      throw new NotFoundException('Inventory API is not enabled on this server');
    }
  }

  /** Validate a token and list the caller's workspaces, for CLI login. */
  @Get('/session')
  async session(@CurrentUser() user: CurrentUserType) {
    this.assertEnabled();
    const workspaceIds = await this.models.workspaceUser.getUserWorkspaceIds(user.id);
    return {
      user: { id: user.id, email: user.email, name: user.name },
      workspaceIds,
    };
  }

  @Get('/workspaces/:workspaceId/devices')
  async list(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Query('kind') kind?: string,
    @Query('agentTarget') agentTarget?: string
  ) {
    this.assertEnabled();
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    const devices = await this.service.list(workspaceId, {
      kind: kind || undefined,
      agentTarget: agentTarget === undefined ? undefined : agentTarget === 'true',
    });
    return { devices };
  }

  @Get('/workspaces/:workspaceId/devices/:key')
  async get(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('key') key: string
  ) {
    this.assertEnabled();
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    const device = await this.service.get(workspaceId, key);
    if (!device) {
      throw new NotFoundException(`No device '${key}' in this workspace`);
    }
    return { device };
  }

  /** Create or update a device. Idempotent on (workspace, key). */
  @Post('/workspaces/:workspaceId/devices')
  async register(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: RegisterDeviceBody
  ) {
    this.assertEnabled();
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
    const device = await this.service.register(workspaceId, user.id, body ?? {});
    return { device };
  }

  @Delete('/workspaces/:workspaceId/devices/:key')
  async remove(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('key') key: string
  ) {
    this.assertEnabled();
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
    const removed = await this.service.remove(workspaceId, key);
    return { ok: removed > 0, removed };
  }

  /**
   * Record a health run. Separate from registration because health runs are
   * frequent and should not have to resend the whole device record.
   */
  @Post('/workspaces/:workspaceId/devices/:key/status')
  async status(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('key') key: string,
    @Body() body: DeviceStatusBody
  ) {
    this.assertEnabled();
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
    const device = await this.service.recordStatus(workspaceId, key, body ?? {});
    if (!device) {
      throw new NotFoundException(`No device '${key}' in this workspace`);
    }
    return { device };
  }
}

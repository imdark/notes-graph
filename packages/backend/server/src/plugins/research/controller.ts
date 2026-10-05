import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import type { CurrentUser as CurrentUserType } from '../../core/auth';
import { CurrentUser } from '../../core/auth';
import { PermissionAccess } from '../../core/permission';
import { getSignal } from '../copilot/utils';
import { OmniSeekClient, RESEARCH_TOOLS } from './omniseek';

/**
 * The Research harness's tools, for the agent loop running in a reader's
 * tab. Calls go to the OmniSeek sidecar from here, so it never has to be
 * reachable from outside, and only the read-and-search tools in
 * RESEARCH_TOOLS can be called. Anyone who can read the workspace may use
 * them, as with the rest of an agent run.
 */
@Controller('/api/workspaces/:workspaceId/research')
export class ResearchController {
  constructor(
    private readonly ac: PermissionAccess,
    private readonly omniseek: OmniSeekClient
  ) {}

  private async assertReady(user: CurrentUserType, workspaceId: string) {
    if (!this.omniseek.configured) {
      throw new NotFoundException('Research is not set up on this server');
    }
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
  }

  @Get('/tools')
  async tools(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Req() req: Request
  ) {
    await this.assertReady(user, workspaceId);
    return { tools: await this.omniseek.listTools(getSignal(req).signal) };
  }

  @Post('/tools/:name')
  async call(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('name') name: string,
    @Body() body: { args?: Record<string, unknown> },
    @Req() req: Request
  ) {
    await this.assertReady(user, workspaceId);
    if (!RESEARCH_TOOLS.includes(name)) {
      throw new NotFoundException(`No research tool '${name}'`);
    }
    const args =
      body?.args && typeof body.args === 'object' && !Array.isArray(body.args)
        ? body.args
        : {};
    return {
      text: await this.omniseek.callTool(name, args, getSignal(req).signal),
    };
  }
}

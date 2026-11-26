import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Models } from '../../models';
import { CurrentUser, Public } from '../auth';
import type { CurrentUser as User } from '../auth/session';
import { PermissionAccess } from '../permission';

/** Where the app loads an agent plugin from: PluginService fetches manifest.json and imports index.js under it. */
export function agentPluginBaseUrl(token: string) {
  return `/api/agent-plugins/${token}`;
}

@Controller('/api')
export class AgentPluginsController {
  constructor(
    private readonly models: Models,
    private readonly ac: PermissionAccess
  ) {}

  /** The plugins agents made for a workspace, for Settings → Plugins. */
  @Get('/workspaces/:workspaceId/agent-plugins')
  async list(
    @CurrentUser() user: User,
    @Param('workspaceId') workspaceId: string
  ) {
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    const plugins = await this.models.agentPlugin.list(workspaceId);
    return {
      plugins: plugins.map(p => ({
        id: p.pluginId,
        version: p.version,
        manifest: p.manifest,
        agent: p.agent,
        updatedAt: p.updatedAt,
        baseUrl: agentPluginBaseUrl(p.token),
      })),
    };
  }

  /**
   * The plugin's files. Public: the app imports them as an ES module, which
   * carries no session from the desktop and mobile apps, so the random token
   * is the access check. Served with CORS for the same reason.
   */
  @Public()
  @Get('/agent-plugins/:token/:file')
  async file(
    @Param('token') token: string,
    @Param('file') file: string,
    @Res() res: Response
  ) {
    if (file !== 'manifest.json' && file !== 'index.js') {
      throw new NotFoundException();
    }
    const plugin = await this.models.agentPlugin.getByToken(token);
    if (!plugin) throw new NotFoundException();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (file === 'manifest.json') {
      res.type('application/json').send(JSON.stringify(plugin.manifest));
    } else {
      res.type('text/javascript').send(plugin.code);
    }
  }
}

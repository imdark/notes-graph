import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import {
  DirectoryProviderRequestError,
  MissingOauthQueryParameter,
  OauthStateExpired,
  UnknownOauthProvider,
  URLHelper,
} from '../../base';
import { CurrentUser, Public } from '../../core/auth';
import { PermissionAccess } from '../../core/permission';
import { DirectoryOAuthService } from './oauth';
import { DirectoryProviderName } from './providers';
import { DirectoryService } from './service';

@Controller('/api/directory')
export class DirectoryController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly oauth: DirectoryOAuthService,
    private readonly access: PermissionAccess,
    private readonly url: URLHelper
  ) {}

  @Post('/oauth/preflight')
  @HttpCode(HttpStatus.OK)
  async preflight(
    @CurrentUser() user: CurrentUser,
    @Body('workspaceId') workspaceId?: string,
    @Body('provider') providerName?: DirectoryProviderName,
    @Body('redirect_uri') redirectUri?: string
  ) {
    if (!workspaceId) {
      throw new MissingOauthQueryParameter({ name: 'workspaceId' });
    }
    if (!providerName) {
      throw new MissingOauthQueryParameter({ name: 'provider' });
    }
    if (!this.directory.isProviderAvailable(providerName)) {
      throw new UnknownOauthProvider({ name: providerName });
    }

    await this.access
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Users.Manage');

    const state = await this.oauth.saveOAuthState({
      provider: providerName,
      workspaceId,
      userId: user.id,
      redirectUri,
    });

    const callbackUrl = this.directory.getCallbackUrl();
    const authUrl = this.directory.getAuthUrl(providerName, state, callbackUrl);

    return { url: authUrl };
  }

  @Public()
  @Get('/oauth/callback')
  @HttpCode(HttpStatus.OK)
  async callback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') stateStr?: string
  ) {
    if (!code) {
      throw new MissingOauthQueryParameter({ name: 'code' });
    }
    if (!stateStr || !this.oauth.isValidState(stateStr)) {
      throw new MissingOauthQueryParameter({ name: 'state' });
    }

    const state = await this.oauth.getOAuthState(stateStr);
    if (!state) {
      throw new OauthStateExpired();
    }

    const callbackUrl = this.directory.getCallbackUrl();
    try {
      await this.directory.handleOAuthCallback({
        provider: state.provider,
        code,
        redirectUri: callbackUrl,
        workspaceId: state.workspaceId,
        connectedByUserId: state.userId,
      });
    } catch (error) {
      if (state.redirectUri) {
        const message = this.getCallbackErrorMessage(error);
        const redirectUrl = this.buildErrorRedirect(state.redirectUri, message);
        return this.url.safeRedirect(res, redirectUrl);
      }
      throw error;
    }

    if (state.redirectUri) {
      return this.url.safeRedirect(res, state.redirectUri);
    }

    return res.status(200).send({ ok: true });
  }

  private buildErrorRedirect(redirectUri: string, message: string) {
    const url = new URL(redirectUri, this.url.requestBaseUrl);
    url.searchParams.set('error', message);
    return url.toString();
  }

  private getCallbackErrorMessage(error: unknown) {
    if (error instanceof DirectoryProviderRequestError) {
      const status = error.data?.status ?? error.status;
      if (status === 403) {
        return 'Google Workspace authorization failed: insufficient permissions. Please reauthorize as a domain admin.';
      }
      return 'Google Workspace authorization failed. Please try again.';
    }
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return 'Google Workspace authorization failed.';
  }
}

import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import type { CurrentUser as CurrentUserType } from '../../core/auth';
import { CurrentUser } from '../../core/auth';
import { PermissionAccess } from '../../core/permission';
import { getSignal } from '../copilot/utils';
import { cleanMessages, DEEPSEEK_MODELS, DeepSeekClient } from './deepseek';

/**
 * DeepSeek as the model of an agent run in a reader's tab: the tab sends the
 * whole conversation each step and reads the reply back as a plain text
 * stream. The key stays here. Like the research tools, anyone who can read
 * the workspace may use it.
 */
@Controller('/api/workspaces/:workspaceId/research/deepseek')
export class DeepSeekController {
  constructor(
    private readonly ac: PermissionAccess,
    private readonly deepseek: DeepSeekClient
  ) {}

  private async assertReady(user: CurrentUserType, workspaceId: string) {
    if (!this.deepseek.configured) {
      throw new NotFoundException('DeepSeek is not set up on this server');
    }
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
  }

  @Get('/')
  async models(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string
  ) {
    await this.assertReady(user, workspaceId);
    return { models: DEEPSEEK_MODELS };
  }

  @Post('/chat')
  async chat(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: { model?: string; messages?: unknown },
    @Req() req: Request,
    @Res() res: Response
  ) {
    await this.assertReady(user, workspaceId);
    const model = body?.model || DEEPSEEK_MODELS[0];
    if (!DEEPSEEK_MODELS.includes(model)) {
      throw new NotFoundException(`No DeepSeek model '${model}'`);
    }
    const messages = cleanMessages(body?.messages);
    if (!messages.length) {
      throw new BadRequestException('messages are required');
    }

    const { signal } = getSignal(req);
    // Opened before anything is written, so a refused key or a DeepSeek
    // outage comes back as an error status rather than a half-sent 200.
    const stream = this.deepseek.chat(model, messages, signal)[
      Symbol.asyncIterator
    ]();
    const first = await stream.next().catch((err: Error) => {
      throw new BadGatewayException(err.message);
    });
    res.status(200).setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    try {
      if (!first.done) res.write(first.value);
      for (let next = await stream.next(); !next.done; next = await stream.next()) {
        res.write(next.value);
      }
    } catch (err) {
      // The status is already sent; end the text with the reason instead.
      if (!signal.aborted) {
        res.write(`\n\n[DeepSeek stopped: ${(err as Error).message}]`);
      }
    }
    res.end();
  }
}

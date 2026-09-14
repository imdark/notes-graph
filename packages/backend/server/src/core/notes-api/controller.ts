import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Put,
  RawBody,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { NotFound } from '../../base';
import { Models } from '../../models';
import type { CurrentUser as CurrentUserType } from '../auth';
import { CurrentUser } from '../auth';
import {
  DatabaseDocReader,
  DocWriter,
  PgWorkspaceDocStorageAdapter,
} from '../doc';
import { PermissionAccess } from '../permission';

/**
 * User-facing (Personal Access Token authenticated) doc API for the notes CLI
 * and, later, the MCP server. Unlike the internal `/rpc` controller, these
 * endpoints go through the normal auth guard (a Bearer PAT authenticates) and
 * enforce per-doc permissions. The CLI reads a doc's Yjs binary and renders it
 * client-side, and pushes Yjs updates to edit.
 */
@Controller('/api/notes')
export class NotesApiController {
  private readonly logger = new Logger(NotesApiController.name);

  constructor(
    private readonly ac: PermissionAccess,
    private readonly models: Models,
    private readonly docReader: DatabaseDocReader,
    private readonly docStorage: PgWorkspaceDocStorageAdapter,
    private readonly docWriter: DocWriter
  ) {}

  /** Validate the token and list the caller's workspaces (used by `login`). */
  @Get('/session')
  async session(@CurrentUser() user: CurrentUserType) {
    const workspaceIds = await this.models.workspaceUser.getUserWorkspaceIds(
      user.id
    );
    return {
      user: { id: user.id, email: user.email, name: user.name },
      workspaceIds,
    };
  }

  private async assertReadable(
    userId: string,
    workspaceId: string,
    docId: string
  ) {
    // The root doc (docId === workspaceId) holds the doc list; gate it on
    // workspace read. Page docs use per-doc read.
    if (docId === workspaceId) {
      await this.ac.user(userId).workspace(workspaceId).assert('Workspace.Read');
    } else {
      await this.ac.user(userId).doc(workspaceId, docId).assert('Doc.Read');
    }
  }

  @Get('/workspaces/:workspaceId/docs/:docId/bin')
  async getDocBin(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('docId') docId: string,
    @Res() res: Response
  ) {
    await this.assertReadable(user.id, workspaceId, docId);
    const doc = await this.docReader.getDoc(workspaceId, docId);
    if (!doc) {
      throw new NotFound('Doc not found');
    }
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('x-doc-timestamp', doc.timestamp.toString());
    res.send(doc.bin);
  }

  @Post('/workspaces/:workspaceId/docs')
  async createDoc(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: { title?: string; markdown?: string }
  ) {
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.CreateDoc');
    const { docId } = await this.docWriter.createDoc(
      workspaceId,
      body.title ?? 'Untitled',
      body.markdown ?? '',
      user.id
    );
    this.logger.log(`created doc ${docId} in ${workspaceId} by ${user.id}`);
    return { docId };
  }

  @Put('/workspaces/:workspaceId/docs/:docId')
  async editDoc(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('docId') docId: string,
    @Body() body: { markdown?: string }
  ) {
    await this.ac.user(user.id).doc(workspaceId, docId).assert('Doc.Update');
    if (typeof body.markdown !== 'string') {
      throw new BadRequestException('markdown is required');
    }
    await this.docWriter.updateDoc(
      workspaceId,
      docId,
      body.markdown,
      user.id
    );
    this.logger.log(`edited doc ${workspaceId}/${docId} by ${user.id}`);
    return { ok: true };
  }

  @Post('/workspaces/:workspaceId/docs/:docId/update')
  async pushUpdate(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('docId') docId: string,
    @RawBody() body?: Buffer
  ) {
    await this.ac.user(user.id).doc(workspaceId, docId).assert('Doc.Update');
    if (!body?.length) {
      throw new BadRequestException('Empty update body');
    }
    await this.docStorage.pushDocUpdates(
      workspaceId,
      docId,
      [new Uint8Array(body)],
      user.id
    );
    this.logger.log(
      `pushed ${body.length}b update to ${workspaceId}/${docId} by ${user.id}`
    );
    return { ok: true };
  }
}

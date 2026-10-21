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

/** A folder path, outermost first, as the API takes it. */
const folderPath = (value: unknown): string[] | null => {
  if (value === undefined || value === null) return null;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 16 ||
    !value.every(
      name => typeof name === 'string' && name.trim() && name.length <= 200
    )
  ) {
    throw new BadRequestException(
      'folder must be a list of 1-16 folder names, outermost first'
    );
  }
  return value as string[];
};

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
      await this.ac
        .user(userId)
        .workspace(workspaceId)
        .assert('Workspace.Read');
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
    @Body() body: { title?: string; markdown?: string; folder?: string[] }
  ) {
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.CreateDoc');
    const folder = folderPath(body.folder);
    const { docId } = await this.docWriter.createDoc(
      workspaceId,
      body.title ?? 'Untitled',
      body.markdown ?? '',
      user.id
    );
    this.logger.log(`created doc ${docId} in ${workspaceId} by ${user.id}`);
    const folderId = folder
      ? await this.fileInFolder(workspaceId, docId, folder, user.id)
      : undefined;
    return { docId, folderId };
  }

  /**
   * File a doc in the workspace's folder tree (the app's Organize folders),
   * making the folders on `folder` that don't exist yet. Filing it again in
   * the same folder changes nothing.
   */
  @Put('/workspaces/:workspaceId/docs/:docId/folder')
  async fileDoc(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('docId') docId: string,
    @Body() body: { folder?: string[] }
  ) {
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.CreateDoc');
    await this.ac.user(user.id).doc(workspaceId, docId).assert('Doc.Read');
    const folder = folderPath(body.folder);
    if (!folder) throw new BadRequestException('folder is required');
    const folderId = await this.fileInFolder(
      workspaceId,
      docId,
      folder,
      user.id
    );
    return { ok: true, folderId };
  }

  /**
   * Link a doc under this one as a real reference, the relationship the
   * sidebar's note tree and backlinks are built from. A markdown link in a
   * doc body is only a hyperlink, so a doc linked that way stays parentless
   * and lands in the Inbox. Additive: existing links are left alone.
   */
  @Post('/workspaces/:workspaceId/docs/:docId/links')
  async linkDoc(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('docId') docId: string,
    @Body() body: { childDocId?: string }
  ) {
    const childDocId =
      typeof body.childDocId === 'string' ? body.childDocId.trim() : '';
    if (!childDocId) throw new BadRequestException('childDocId is required');
    await this.ac.user(user.id).doc(workspaceId, docId).assert('Doc.Update');
    await this.ac.user(user.id).doc(workspaceId, childDocId).assert('Doc.Read');
    await this.docWriter.linkDoc(workspaceId, docId, childDocId, user.id);
    this.logger.log(`linked ${childDocId} under ${workspaceId}/${docId}`);
    return { ok: true };
  }

  private async fileInFolder(
    workspaceId: string,
    docId: string,
    folder: string[],
    userId: string
  ): Promise<string> {
    const folderId = await this.docWriter.fileInFolder(
      workspaceId,
      docId,
      folder,
      userId
    );
    this.logger.log(
      `filed ${docId} in ${workspaceId} under ${folder.join(' / ')}`
    );
    return folderId;
  }

  @Put('/workspaces/:workspaceId/docs/:docId')
  async editDoc(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('docId') docId: string,
    @Body() body: { markdown?: string; title?: string }
  ) {
    await this.ac.user(user.id).doc(workspaceId, docId).assert('Doc.Update');
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (typeof body.markdown !== 'string' && !title) {
      throw new BadRequestException('markdown or title is required');
    }
    if (typeof body.markdown === 'string') {
      await this.docWriter.updateDoc(
        workspaceId,
        docId,
        body.markdown,
        user.id
      );
    }
    if (title) {
      await this.docWriter.updateDocMeta(
        workspaceId,
        docId,
        { title },
        user.id
      );
    }
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

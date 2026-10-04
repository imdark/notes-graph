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

import { BadRequest, Config } from '../../base';
import type { CurrentUser as CurrentUserType } from '../../core/auth';
import { CurrentUser } from '../../core/auth';
import { PermissionAccess } from '../../core/permission';
import { Models } from '../../models';
import { InventoryJobService } from './jobs';
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
    private readonly jobs: InventoryJobService,
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

  // ── phone push ─────────────────────────────────────────────────────────
  //
  // Per user, not per workspace: a run's questions go to whoever started it,
  // in whichever workspace it runs.

  /** A phone asks to be told when a run it started is waiting on it. */
  @Post('/push-tokens')
  async registerPushToken(
    @CurrentUser() user: CurrentUserType,
    @Body() body: { token?: string; platform?: string }
  ) {
    this.assertEnabled();
    const token = String(body?.token ?? '').trim();
    if (!token || token.length > 4096) {
      throw new BadRequest('token is required');
    }
    const platform = body?.platform === 'ios' ? 'ios' : 'android';
    await this.models.userPushToken.register(user.id, token, platform);
    return { ok: true, enabled: !!this.config.inventory.fcmServiceAccount };
  }

  /** On sign-out: this phone should stop hearing about this user's runs. */
  @Post('/push-tokens/remove')
  async removePushToken(
    @CurrentUser() user: CurrentUserType,
    @Body() body: { token?: string }
  ) {
    this.assertEnabled();
    const removed = await this.models.userPushToken.unregister(
      user.id,
      String(body?.token ?? '')
    );
    return { ok: removed > 0 };
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

  // ── agent jobs ─────────────────────────────────────────────────────────
  //
  // Enqueue is privileged: it makes someone else's machine run something, so
  // it needs the same permission as changing the fleet. Reading a job's
  // progress only needs workspace read, so the UI can poll a run it started.

  @Post('/workspaces/:workspaceId/devices/:key/jobs')
  async enqueueJob(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('key') key: string,
    @Body() body: Record<string, unknown>
  ) {
    this.assertEnabled();
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
    const job = await this.jobs.enqueue(workspaceId, user.id, key, body ?? {});
    return { job };
  }

  @Get('/workspaces/:workspaceId/jobs')
  async listJobs(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Query('device') device?: string,
    @Query('status') status?: string
  ) {
    this.assertEnabled();
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    return { jobs: await this.jobs.list(workspaceId, device || undefined, status || undefined) };
  }

  @Get('/workspaces/:workspaceId/jobs/:jobId')
  async getJob(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('jobId') jobId: string,
    @Query('logFrom') logFrom?: string
  ) {
    this.assertEnabled();
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    // The transcript always comes with a single job; `logFrom` lets a viewer
    // that already has the first N characters ask only for what's new.
    const from = Number(logFrom);
    const job = await this.jobs.get(
      workspaceId,
      jobId,
      Number.isFinite(from) && from > 0 ? from : 0
    );
    if (!job) {
      throw new NotFoundException(`No job '${jobId}' in this workspace`);
    }
    return { job };
  }

  /**
   * A device asks for its next job. Returns `{ job: null }` when idle.
   *
   * Workspace.Read, not Settings.Update: this is a runner doing the work it
   * was already given, and a polling machine holds this credential
   * permanently. Requiring settings-update would mean every device in the
   * field carried a token that could also register and remove devices across
   * the whole workspace - one compromised machine would take the fleet with
   * it. Dispatching work (enqueue) and stopping it (cancel) stay privileged.
   *
   * The residual gap is that any workspace member can now claim or report,
   * so a member could take work or file a false result. Closing that needs a
   * per-device credential rather than a user token; this at least stops a
   * runner's token from being an admin one.
   */
  @Post('/workspaces/:workspaceId/devices/:key/jobs/claim')
  async claimJob(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('key') key: string,
    @Body() body: { runnerId?: string; leaseSeconds?: number }
  ) {
    this.assertEnabled();
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    const job = await this.jobs.claim(
      workspaceId, key, body?.runnerId ?? 'runner', body?.leaseSeconds
    );
    return { job };
  }

  /** A device reports progress or a result. Also renews the lease. */
  @Post('/workspaces/:workspaceId/jobs/:jobId/report')
  async reportJob(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('jobId') jobId: string,
    @Body() body: Record<string, unknown>
  ) {
    this.assertEnabled();
    // Workspace.Read for the same reason as claim above - a runner reporting
    // on its own job should not need a token that can rewrite the fleet.
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    const job = await this.jobs.report(workspaceId, jobId, body ?? {});
    if (!job) {
      throw new NotFoundException(`No job '${jobId}' in this workspace`);
    }
    return { job };
  }

  @Post('/workspaces/:workspaceId/jobs/:jobId/cancel')
  async cancelJob(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('jobId') jobId: string
  ) {
    this.assertEnabled();
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
    const job = await this.jobs.cancel(workspaceId, jobId);
    if (!job) {
      throw new NotFoundException(`No job '${jobId}' in this workspace`);
    }
    return { job };
  }

  /**
   * A running job asks its starter something and then polls for the answer.
   * Workspace.Read, like claim and report: it is the runner's own side of a
   * job it was already given.
   */
  @Post('/workspaces/:workspaceId/jobs/:jobId/questions')
  async askQuestion(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('jobId') jobId: string,
    @Body() body: Record<string, unknown>
  ) {
    this.assertEnabled();
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    return { question: await this.jobs.ask(workspaceId, jobId, body ?? {}) };
  }

  @Get('/workspaces/:workspaceId/jobs/:jobId/questions/:questionId')
  async getQuestion(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('jobId') jobId: string,
    @Param('questionId') questionId: string
  ) {
    this.assertEnabled();
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    return this.jobs.getQuestion(workspaceId, jobId, questionId);
  }

  /** Answering is narrower still: the service only lets the job's starter. */
  @Post('/workspaces/:workspaceId/jobs/:jobId/questions/:questionId/answer')
  async answerQuestion(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('jobId') jobId: string,
    @Param('questionId') questionId: string,
    @Body() body: Record<string, unknown>
  ) {
    this.assertEnabled();
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    return {
      question: await this.jobs.answer(
        workspaceId,
        jobId,
        questionId,
        user.id,
        body ?? {}
      ),
    };
  }
}

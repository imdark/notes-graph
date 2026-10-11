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
import { InventoryHealthService } from './health';
import { InventoryJobService } from './jobs';
import { type AgentSettings, MonitoringAgentService } from './monitoring-agent';
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
    private readonly health: InventoryHealthService,
    private readonly monitoringAgent: MonitoringAgentService,
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

  // ── health checks ──────────────────────────────────────────────────────
  //
  // A check runs a fixed script on the machine, so it needs what enqueueing
  // any job does. Its result lands as the device's status.

  @Post('/workspaces/:workspaceId/devices/:key/check')
  async checkDevice(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('key') key: string
  ) {
    this.assertEnabled();
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
    return { job: await this.health.check(workspaceId, user.id, key) };
  }

  @Post('/workspaces/:workspaceId/check')
  async checkAll(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string
  ) {
    this.assertEnabled();
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
    return await this.health.checkAll(workspaceId, user.id);
  }

  // ── monitoring agent ───────────────────────────────────────────────────
  //
  // Reading what it learned and decided is workspace read. Changing it, and
  // triaging (which runs Claude on a machine), need what enqueueing a job does.

  @Get('/workspaces/:workspaceId/monitoring-agent')
  async getMonitoringAgent(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string
  ) {
    this.assertEnabled();
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    return { agent: await this.monitoringAgent.get(workspaceId) };
  }

  @Post('/workspaces/:workspaceId/monitoring-agent')
  async configureMonitoringAgent(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: AgentSettings
  ) {
    this.assertEnabled();
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
    return { agent: await this.monitoringAgent.configure(workspaceId, user.id, body ?? {}) };
  }

  /** Forget what was learned: all of it, or one machine's (`{ deviceKey }`). */
  @Post('/workspaces/:workspaceId/monitoring-agent/reset')
  async resetMonitoringAgent(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: { deviceKey?: string }
  ) {
    this.assertEnabled();
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
    return await this.monitoringAgent.reset(workspaceId, user.id, body?.deviceKey || undefined);
  }

  @Get('/workspaces/:workspaceId/monitoring-agent/decisions')
  async monitoringDecisions(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Query('limit') limit?: string
  ) {
    this.assertEnabled();
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    const n = Number(limit);
    return {
      decisions: await this.monitoringAgent.decisions(workspaceId, Number.isFinite(n) && n > 0 ? n : 100),
    };
  }

  @Post('/workspaces/:workspaceId/monitoring-agent/decisions/:decisionId/triage')
  async triageDecision(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('decisionId') decisionId: string
  ) {
    this.assertEnabled();
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
    return { decision: await this.monitoringAgent.triage(workspaceId, user.id, decisionId) };
  }

  /** `{ verdict: 'expected' | 'resolved' }`: teach it, or let it alert again. */
  @Post('/workspaces/:workspaceId/monitoring-agent/decisions/:decisionId/feedback')
  async decisionFeedback(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('decisionId') decisionId: string,
    @Body() body: { verdict?: string }
  ) {
    this.assertEnabled();
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
    return {
      decision: await this.monitoringAgent.feedback(workspaceId, decisionId, String(body?.verdict ?? '')),
    };
  }

  /** Each machine's catalog of log patterns: what its logs normally say. */
  @Get('/workspaces/:workspaceId/monitoring-agent/logs')
  async monitoringLogPatterns(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string
  ) {
    this.assertEnabled();
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    return { catalogs: await this.monitoringAgent.logPatterns(workspaceId) };
  }

  /** `{ label: 'known' | null }`: a pattern that is never news, or judged again. */
  @Post('/workspaces/:workspaceId/monitoring-agent/logs/:key/:patternId/label')
  async labelLogPattern(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('key') key: string,
    @Param('patternId') patternId: string,
    @Body() body: { label?: string | null }
  ) {
    this.assertEnabled();
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
    return {
      pattern: await this.monitoringAgent.labelPattern(workspaceId, key, patternId, body?.label ?? null),
    };
  }

  /**
   * Log lines a machine sends itself (the wf CLI, or any shipper), for the
   * agent to learn from: `{ lines: string[], until?: epoch seconds }`. The
   * lines are redacted and mined; none is kept as sent.
   */
  @Post('/workspaces/:workspaceId/devices/:key/logs')
  async deviceLogs(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('key') key: string,
    @Body() body: { lines?: unknown; until?: number }
  ) {
    this.assertEnabled();
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
    if (!Array.isArray(body?.lines)) throw new BadRequest('lines must be an array of strings');
    const device = await this.service.get(workspaceId, key);
    if (!device) throw new NotFoundException(`No device '${key}' in this workspace`);
    const now = Date.now() / 1000;
    const until = Number(body.until);
    const decisions = await this.monitoringAgent.observeLogs(
      workspaceId,
      device.key,
      body.lines.map(line => String(line)),
      Number.isFinite(until) && until > 0 && until <= now + 60 ? until : now
    );
    return { decisions: decisions.length };
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

  /**
   * The agent names its run. Workspace.Read, like report: it is the job's
   * own side of work it was already given.
   */
  @Post('/workspaces/:workspaceId/jobs/:jobId/title')
  async setJobTitle(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('jobId') jobId: string,
    @Body() body: Record<string, unknown>
  ) {
    this.assertEnabled();
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    const job = await this.jobs.setTitle(workspaceId, jobId, body ?? {});
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
   * "Allow all" before the run asks anything. Workspace.Read, like answering:
   * the service only lets the job's starter.
   */
  @Post('/workspaces/:workspaceId/jobs/:jobId/allow-all')
  async allowAllTools(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('jobId') jobId: string
  ) {
    this.assertEnabled();
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    return { job: await this.jobs.allowAll(workspaceId, jobId, user.id) };
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

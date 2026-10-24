import { randomBytes } from 'node:crypto';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type {
  Automation,
  AutomationDeployment,
  AutomationRun,
  Prisma,
} from '@prisma/client';

import { BadRequest, NotFound, Throttle } from '../../base';
import type { CurrentUser as CurrentUserType } from '../../core/auth';
import { CurrentUser, Public } from '../../core/auth';
import { PermissionAccess } from '../../core/permission';
import { Models, sha256 } from '../../models';
import { AUTOMATION_TEMPLATES } from './hooks';
import { AutomationService, MAX_TIMEOUT_SECONDS } from './service';
import {
  hasTrigger,
  nextRunAt,
  parseTriggers,
  type Trigger,
  TriggerError,
} from './triggers';

/** Longest code an automation version may hold. */
export const MAX_CODE_CHARS = 200_000;
const MAX_RETRIES = 5;

const seconds = (date: Date) => date.getTime() / 1000;

export const toAutomationDto = (
  automation: Automation,
  deployments: AutomationDeployment[] = []
) => ({
  id: automation.id,
  name: automation.name,
  docId: automation.docId,
  blockId: automation.blockId,
  runtime: automation.runtime,
  triggers: automation.triggers as unknown as Trigger[],
  secrets: automation.secrets,
  timeoutSeconds: automation.timeoutSeconds,
  maxRetries: automation.maxRetries,
  enabled: automation.enabled,
  hasWebhook: !!automation.webhookTokenHash,
  nextRunAt: automation.nextRunAt ? seconds(automation.nextRunAt) : null,
  lastRunAt: automation.lastRunAt ? seconds(automation.lastRunAt) : null,
  deployments: deployments.map(d => ({
    target: d.target,
    versionId: d.versionId,
    deployedAt: seconds(d.updatedAt),
  })),
});

export const toRunDto = (run: AutomationRun, withLogs = false) => ({
  id: run.id,
  versionId: run.versionId,
  target: run.target,
  trigger: run.trigger,
  status: run.status,
  attempt: run.attempt,
  output: run.output,
  error: run.error,
  jobId: run.jobId,
  ...(withLogs ? { input: run.input, logs: run.logs } : {}),
  createdAt: seconds(run.createdAt),
  startedAt: run.startedAt ? seconds(run.startedAt) : null,
  finishedAt: run.finishedAt ? seconds(run.finishedAt) : null,
});

/** Only the fields a person sets; the rest are the automation's own state. */
export function parseDefinition(body: Record<string, any>, partial: boolean) {
  const out: {
    name?: string;
    docId?: string | null;
    blockId?: string | null;
    triggers?: Trigger[];
    secrets?: string[];
    timeoutSeconds?: number;
    maxRetries?: number;
    enabled?: boolean;
  } = {};
  if (body.name !== undefined || !partial) {
    const name = String(body.name ?? '')
      .trim()
      .slice(0, 200);
    if (!name) throw new BadRequest('name is required');
    out.name = name;
  }
  if (body.docId !== undefined)
    out.docId = body.docId ? String(body.docId) : null;
  if (body.blockId !== undefined) {
    out.blockId = body.blockId ? String(body.blockId) : null;
  }
  if (body.triggers !== undefined || !partial) {
    try {
      out.triggers = parseTriggers(body.triggers);
    } catch (err) {
      if (err instanceof TriggerError) throw new BadRequest(err.message);
      throw err;
    }
  }
  if (body.secrets !== undefined) {
    if (!Array.isArray(body.secrets)) {
      throw new BadRequest('secrets must be a list of names');
    }
    out.secrets = [...new Set(body.secrets.map(String))].slice(0, 50);
  }
  if (body.timeoutSeconds !== undefined) {
    const timeout = Number(body.timeoutSeconds);
    if (!Number.isFinite(timeout) || timeout < 1) {
      throw new BadRequest('timeoutSeconds must be at least 1');
    }
    out.timeoutSeconds = Math.min(Math.round(timeout), MAX_TIMEOUT_SECONDS);
  }
  if (body.maxRetries !== undefined) {
    const retries = Number(body.maxRetries);
    if (!Number.isFinite(retries) || retries < 0) {
      throw new BadRequest('maxRetries must be 0 or more');
    }
    out.maxRetries = Math.min(Math.round(retries), MAX_RETRIES);
  }
  if (body.enabled !== undefined) out.enabled = !!body.enabled;
  return out;
}

function parseCode(raw: unknown) {
  const code = typeof raw === 'string' ? raw : '';
  if (!code.trim()) throw new BadRequest('code is required');
  if (code.length > MAX_CODE_CHARS) {
    throw new BadRequest(`code exceeds ${MAX_CODE_CHARS} characters`);
  }
  return code;
}

/** A webhook token: shown once, kept only as its hash. */
const newWebhookToken = () => randomBytes(24).toString('base64url');

/**
 * A workspace's automations. Reading needs workspace read; anything that
 * changes, deploys or runs code needs workspace settings, like queueing an
 * agent job does.
 */
@Controller('/api/workspaces/:workspaceId/automations')
export class AutomationController {
  constructor(
    private readonly ac: PermissionAccess,
    private readonly models: Models,
    private readonly automations: AutomationService
  ) {}

  private async assertRead(user: CurrentUserType, workspaceId: string) {
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
  }

  private async assertManage(user: CurrentUserType, workspaceId: string) {
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings.Update');
  }

  @Get('/')
  async list(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string
  ) {
    await this.assertRead(user, workspaceId);
    const automations = await this.models.automation.list(workspaceId);
    return {
      automations: await Promise.all(
        automations.map(async a =>
          toAutomationDto(a, await this.models.automation.listDeployments(a.id))
        )
      ),
    };
  }

  /** Create one; with `code`, its first version is saved too. */
  @Post('/')
  async create(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Record<string, any>
  ) {
    await this.assertManage(user, workspaceId);
    const definition = parseDefinition(body ?? {}, false);
    const code = body?.code === undefined ? null : parseCode(body.code);
    const triggers = definition.triggers ?? [];
    const token = hasTrigger(triggers, 'webhook') ? newWebhookToken() : null;
    const automation = await this.models.automation.create({
      workspaceId,
      createdBy: user.id,
      ...definition,
      name: definition.name ?? '',
      triggers: triggers as unknown as Prisma.InputJsonValue,
      nextRunAt: nextRunAt(triggers, new Date()),
    });
    if (token) {
      await this.models.automation.update(automation.id, {
        webhookTokenHash: sha256(token),
      });
    }
    const version = code
      ? await this.models.automation.addVersion(automation.id, code, user.id)
      : null;
    return {
      automation: toAutomationDto(automation),
      version: version ? { id: version.id, number: version.number } : null,
      ...(token ? { webhookToken: token } : {}),
    };
  }

  /** Ready-made automations to start from. Before `/:id`, which would take it. */
  @Get('/templates')
  async templates(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string
  ) {
    await this.assertRead(user, workspaceId);
    return { templates: AUTOMATION_TEMPLATES };
  }

  @Get('/:id')
  async get(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string
  ) {
    await this.assertRead(user, workspaceId);
    const automation = await this.automations.getOwned(workspaceId, id);
    const [deployments, versions, latest] = await Promise.all([
      this.models.automation.listDeployments(id),
      this.models.automation.listVersions(id),
      this.models.automation.latestVersion(id),
    ]);
    return {
      automation: toAutomationDto(automation, deployments),
      versions: versions.map(v => ({
        id: v.id,
        number: v.number,
        createdBy: v.createdBy,
        createdAt: seconds(v.createdAt),
      })),
      code: latest?.code ?? null,
    };
  }

  @Patch('/:id')
  async update(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: Record<string, any>
  ) {
    await this.assertManage(user, workspaceId);
    const existing = await this.automations.getOwned(workspaceId, id);
    const changes = parseDefinition(body ?? {}, true);
    const triggers =
      changes.triggers ?? (existing.triggers as unknown as Trigger[]);
    const enabled = changes.enabled ?? existing.enabled;
    // A webhook trigger added now gets its token now; one removed drops it.
    const token =
      hasTrigger(triggers, 'webhook') && !existing.webhookTokenHash
        ? newWebhookToken()
        : null;
    const automation = await this.models.automation.update(id, {
      ...changes,
      triggers: triggers as unknown as Prisma.InputJsonValue,
      nextRunAt: enabled ? nextRunAt(triggers, new Date()) : null,
      ...(token
        ? { webhookTokenHash: sha256(token) }
        : hasTrigger(triggers, 'webhook')
          ? {}
          : { webhookTokenHash: null }),
    });
    return {
      automation: toAutomationDto(
        automation,
        await this.models.automation.listDeployments(id)
      ),
      ...(token ? { webhookToken: token } : {}),
    };
  }

  @Delete('/:id')
  async remove(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string
  ) {
    await this.assertManage(user, workspaceId);
    await this.automations.getOwned(workspaceId, id);
    await this.models.automation.delete(id);
    return { deleted: true };
  }

  /** Save code as a new version; the same code twice keeps one version. */
  @Post('/:id/versions')
  async saveVersion(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: { code?: unknown }
  ) {
    await this.assertManage(user, workspaceId);
    await this.automations.getOwned(workspaceId, id);
    const version = await this.models.automation.addVersion(
      id,
      parseCode(body?.code),
      user.id
    );
    return { version: { id: version.id, number: version.number } };
  }

  @Get('/:id/versions/:versionId')
  async getVersion(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Param('versionId') versionId: string
  ) {
    await this.assertRead(user, workspaceId);
    await this.automations.getOwned(workspaceId, id);
    const version = await this.models.automation.getVersion(id, versionId);
    if (!version) throw new NotFound('Version not found');
    return {
      version: {
        id: version.id,
        number: version.number,
        code: version.code,
        createdBy: version.createdBy,
        createdAt: seconds(version.createdAt),
      },
    };
  }

  /**
   * Run a version on a device (its latest unless one is named). The device
   * must be an agent target: registering one is not consent to run code.
   */
  @Post('/:id/deploy')
  async deploy(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: { target?: unknown; versionId?: unknown }
  ) {
    await this.assertManage(user, workspaceId);
    await this.automations.getOwned(workspaceId, id);
    const target = String(body?.target ?? '').trim();
    if (!target) throw new BadRequest('target is required');
    const device = await this.models.registryDevice.get(workspaceId, target);
    if (!device) {
      throw new BadRequest(`No device '${target}' in this workspace`);
    }
    if (!device.agentTarget) {
      throw new BadRequest(
        `Device '${target}' doesn't allow running code. Re-register it with agent execution allowed.`
      );
    }
    const version = body?.versionId
      ? await this.models.automation.getVersion(id, String(body.versionId))
      : await this.models.automation.latestVersion(id);
    if (!version) throw new BadRequest('Save some code before deploying');
    const deployment = await this.models.automation.deploy(
      id,
      target,
      version.id,
      user.id
    );
    return {
      deployment: {
        target: deployment.target,
        versionId: deployment.versionId,
        deployedAt: seconds(deployment.updatedAt),
      },
    };
  }

  @Delete('/:id/deployments/:target')
  async undeploy(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Param('target') target: string
  ) {
    await this.assertManage(user, workspaceId);
    await this.automations.getOwned(workspaceId, id);
    await this.models.automation.undeploy(id, target);
    return { deleted: true };
  }

  /** "Run now": a manual run, with optional input. */
  @Post('/:id/run')
  async runNow(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: { input?: unknown; target?: unknown }
  ) {
    await this.assertManage(user, workspaceId);
    const automation = await this.automations.getOwned(workspaceId, id);
    const run = await this.automations.start(
      automation,
      { type: 'manual', by: user.id },
      body?.input ?? null,
      { target: body?.target ? String(body.target) : undefined }
    );
    return { run: toRunDto(run) };
  }

  @Get('/:id/runs')
  async runs(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string
  ) {
    await this.assertRead(user, workspaceId);
    await this.automations.getOwned(workspaceId, id);
    const runs = await this.models.automation.listRuns(id, 100);
    return { runs: runs.map(run => toRunDto(run)) };
  }

  @Get('/:id/runs/:runId')
  async run(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Param('runId') runId: string
  ) {
    await this.assertRead(user, workspaceId);
    await this.automations.getOwned(workspaceId, id);
    const run = await this.models.automation.getRun(id, runId);
    if (!run) throw new NotFound('Run not found');
    return { run: toRunDto(run, true) };
  }

  /** A new webhook token; the old one stops working at once. */
  @Post('/:id/rotate-token')
  async rotateToken(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string
  ) {
    await this.assertManage(user, workspaceId);
    const automation = await this.automations.getOwned(workspaceId, id);
    if (!hasTrigger(automation.triggers as unknown as Trigger[], 'webhook')) {
      throw new BadRequest('This automation has no webhook trigger');
    }
    const token = newWebhookToken();
    await this.models.automation.update(id, {
      webhookTokenHash: sha256(token),
    });
    return { webhookToken: token };
  }
}

/**
 * Webhooks: anyone holding an automation's token can start it, with the
 * request body as its input. The token is the only credential, so the
 * route is public and throttled.
 */
@Public()
@Throttle('default', { limit: 30, ttl: 60_000 })
@Controller('/api/automations/hooks')
export class AutomationWebhookController {
  constructor(
    private readonly models: Models,
    private readonly automations: AutomationService
  ) {}

  @Post('/:token')
  @HttpCode(202)
  async hook(@Param('token') token: string, @Body() body: unknown) {
    const automation = token
      ? await this.models.automation.findByWebhookToken(token)
      : null;
    // A wrong token and a disabled automation look the same from outside.
    if (
      !automation ||
      !automation.enabled ||
      !hasTrigger(automation.triggers as unknown as Trigger[], 'webhook')
    ) {
      throw new NotFound('Not found');
    }
    const run = await this.automations.start(
      automation,
      { type: 'webhook' },
      body ?? null
    );
    return { runId: run.id };
  }
}

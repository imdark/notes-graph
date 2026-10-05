import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { Monitor, MonitorReading, Prisma } from '@prisma/client';

import { BadRequest } from '../../base';
import type { CurrentUser as CurrentUserType } from '../../core/auth';
import { CurrentUser } from '../../core/auth';
import { PermissionAccess } from '../../core/permission';
import { Models } from '../../models';
import {
  type MonitorAlerts,
  type MonitorSpec,
  MonitorService,
} from './service';

/** Wire shape for a monitor. Times are epoch seconds, like the job DTOs. */
export interface MonitorDto {
  id: string;
  name: string;
  docId: string;
  blockId: string;
  kind: string;
  source: string | null;
  deviceKey: string | null;
  spec: MonitorSpec;
  intervalMinutes: number;
  condition: unknown;
  alerts: MonitorAlerts;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt: number | null;
  lastValue: string | null;
  lastError: string | null;
  pending: boolean;
}

const seconds = (date: Date) => date.getTime() / 1000;

export const toMonitorDto = (monitor: Monitor): MonitorDto => ({
  id: monitor.id,
  name: monitor.name,
  docId: monitor.docId,
  blockId: monitor.blockId,
  kind: monitor.kind,
  source: monitor.source,
  deviceKey: monitor.deviceKey,
  spec: monitor.spec as MonitorSpec,
  intervalMinutes: monitor.intervalMinutes,
  condition: monitor.condition,
  alerts: monitor.alerts as MonitorAlerts,
  enabled: monitor.enabled,
  nextRunAt: seconds(monitor.nextRunAt),
  lastRunAt: monitor.lastRunAt ? seconds(monitor.lastRunAt) : null,
  lastValue: monitor.lastValue,
  lastError: monitor.lastError,
  pending: !!monitor.pendingJobId,
});

const toReadingDto = (reading: MonitorReading) => ({
  value: reading.value,
  error: reading.error,
  changed: reading.changed,
  alerted: reading.alerted,
  at: seconds(reading.at),
});

/** Only the fields a person sets; the rest are the monitor's own state. */
function parseDefinition(body: Record<string, any>, partial: boolean) {
  const out: Record<string, unknown> = {};
  const take = (key: string, parse: (value: any) => unknown) => {
    if (body[key] !== undefined) out[key] = parse(body[key]);
    else if (!partial && ['name', 'docId', 'blockId', 'kind', 'intervalMinutes'].includes(key)) {
      throw new BadRequest(`${key} is required`);
    }
  };
  take('name', v => String(v).trim().slice(0, 200));
  take('docId', String);
  take('blockId', String);
  take('kind', String);
  take('source', v => (v === null ? null : String(v)));
  take('deviceKey', v => (v ? String(v) : null));
  take('spec', v => (v && typeof v === 'object' ? v : {}));
  take('intervalMinutes', Number);
  take('condition', v => (v && typeof v === 'object' ? v : { type: 'change' }));
  take('alerts', v => ({ inApp: !!v?.inApp, push: !!v?.push, email: !!v?.email }));
  take('enabled', Boolean);
  if (out.name === '') throw new BadRequest('name is required');
  return out;
}

/**
 * A person's monitors in a workspace. Listing needs workspace read; making,
 * changing or running one needs edit access to the note it writes into.
 */
@Controller('/api/workspaces/:workspaceId/monitors')
export class MonitorController {
  constructor(
    private readonly ac: PermissionAccess,
    private readonly models: Models,
    private readonly monitors: MonitorService
  ) {}

  private async assertCanWrite(user: CurrentUserType, workspaceId: string, docId: string) {
    await this.ac.user(user.id).workspace(workspaceId).doc(docId).assert('Doc.Update');
  }

  @Get('/')
  async list(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string
  ) {
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    const monitors = await this.models.monitor.listByUser(workspaceId, user.id);
    return { monitors: monitors.map(toMonitorDto) };
  }

  @Post('/')
  async create(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Record<string, any>
  ) {
    const definition = parseDefinition(body ?? {}, false) as any;
    await this.assertCanWrite(user, workspaceId, definition.docId);
    this.monitors.validate({
      kind: definition.kind,
      source: definition.source,
      deviceKey: definition.deviceKey,
      spec: definition.spec ?? {},
      intervalMinutes: definition.intervalMinutes,
    });
    const monitor = await this.models.monitor.create({
      workspaceId,
      createdBy: user.id,
      ...definition,
      spec: (definition.spec ?? {}) as Prisma.InputJsonValue,
      condition: (definition.condition ?? { type: 'change' }) as Prisma.InputJsonValue,
      alerts: (definition.alerts ?? {}) as Prisma.InputJsonValue,
    });
    // First reading straight away, rather than at the next cron tick.
    await this.monitors.schedule(monitor.id);
    return { monitor: toMonitorDto(monitor) };
  }

  @Patch('/:id')
  async update(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: Record<string, any>
  ) {
    const existing = await this.monitors.getOwned(workspaceId, user.id, id);
    const changes = parseDefinition(body ?? {}, true) as any;
    const docId = changes.docId ?? existing.docId;
    await this.assertCanWrite(user, workspaceId, docId);
    this.monitors.validate({
      kind: changes.kind ?? existing.kind,
      source: changes.source !== undefined ? changes.source : existing.source,
      deviceKey: changes.deviceKey !== undefined ? changes.deviceKey : existing.deviceKey,
      spec: changes.spec ?? (existing.spec as MonitorSpec),
      intervalMinutes: changes.intervalMinutes ?? existing.intervalMinutes,
    });
    // Turning a paused monitor back on gives it a clean slate.
    const resuming = changes.enabled === true && !existing.enabled;
    const monitor = await this.models.monitor.update(id, {
      ...changes,
      ...(resuming ? { failureCount: 0, nextRunAt: new Date() } : {}),
    });
    return { monitor: toMonitorDto(monitor) };
  }

  @Delete('/:id')
  async remove(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string
  ) {
    await this.monitors.getOwned(workspaceId, user.id, id);
    await this.models.monitor.delete(id);
    return { deleted: true };
  }

  @Post('/:id/run')
  async runNow(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string
  ) {
    const monitor = await this.monitors.getOwned(workspaceId, user.id, id);
    await this.assertCanWrite(user, workspaceId, monitor.docId);
    await this.monitors.schedule(monitor.id);
    return { queued: true };
  }

  @Get('/:id/readings')
  async readings(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string
  ) {
    await this.monitors.getOwned(workspaceId, user.id, id);
    const readings = await this.models.monitor.listReadings(id, 100);
    return { readings: readings.map(toReadingDto) };
  }

  /** Fetch and extract once, writing nothing: the editor's "Test now". */
  @Post('/test')
  async test(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Body() body: { spec?: MonitorSpec }
  ) {
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');
    return { value: await this.monitors.test(body?.spec ?? {}) };
  }
}

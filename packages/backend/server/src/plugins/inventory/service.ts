import { Injectable, Logger, Optional } from '@nestjs/common';

// `BadRequest`, not Nest's `BadRequestException`: the global filter's
// `mapAnyError` passes through only UserFriendlyError, NotFoundException,
// ZodError and HttpError. A plain HttpException falls to its else branch and
// is reported as a 500, so a caller is told "an internal error occurred"
// about input that is entirely their own to fix.
import { BadRequest, Config, EventBus } from '../../base';
import { Models } from '../../models';
import {
  DEVICE_KINDS,
  DEVICE_STATES,
  type DeviceDto,
  type DeviceStatusBody,
  type RegisterDeviceBody,
  toDeviceDto,
} from './types';

declare global {
  interface Events {
    /** A machine's status was recorded: a health check or the wf CLI. */
    'inventory.device.status': {
      workspaceId: string;
      key: string;
      checks: unknown[];
    };
  }
}

/**
 * Validation and persistence for inventory devices.
 *
 * Kept separate from the controller so the rules are testable without an
 * HTTP layer, and so a future GraphQL resolver or MCP tool can reuse them.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly models: Models,
    private readonly config: Config,
    @Optional() private readonly event?: EventBus
  ) {}

  private normalizeKey(raw: string | undefined): string {
    const key = (raw ?? '').trim();
    if (!key) {
      throw new BadRequest('key is required');
    }
    // Keys land in URL paths, so keep them to a conservative alphabet. The
    // colon is allowed because folder targets are namespaced `machine:folder`.
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
      throw new BadRequest(
        'key must be 1-128 chars of letters, digits, dot, dash, underscore or colon'
      );
    }
    return key;
  }

  async register(
    workspaceId: string,
    userId: string,
    body: RegisterDeviceBody
  ): Promise<DeviceDto> {
    const key = this.normalizeKey(body.key);

    const kind = body.kind ?? 'machine';
    if (!DEVICE_KINDS.includes(kind as never)) {
      throw new BadRequest(`kind must be one of ${DEVICE_KINDS.join(', ')}`);
    }
    if (kind === 'folder' && !body.path) {
      throw new BadRequest('folder targets require a path');
    }

    const port = body.port ?? 22;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadRequest('port must be between 1 and 65535');
    }

    // Only count against the cap when this is a new device, so re-registering
    // an existing one keeps working at the limit.
    const existing = await this.models.inventoryDevice.get(workspaceId, key);
    if (!existing) {
      const max = this.config.inventory.maxDevicesPerWorkspace;
      const count = (await this.models.inventoryDevice.list(workspaceId)).length;
      if (count >= max) {
        throw new BadRequest(
          `Workspace already holds ${count} inventory devices (max ${max})`
        );
      }
    }

    const device = await this.models.inventoryDevice.upsert({
      workspaceId,
      key,
      name: (body.name ?? key).slice(0, 200),
      kind,
      host: body.host ?? '',
      user: body.user ?? '',
      port,
      parentKey: body.parentKey ?? null,
      path: body.path ?? null,
      recipe: body.recipe ?? 'generic',
      repo: body.repo ?? null,
      branch: body.branch ?? 'main',
      channel: body.channel ?? 'stable',
      pin: body.pin ?? null,
      agentTarget: body.agentTarget ?? false,
      labels: (body.labels ?? {}) as never,
      registeredBy: userId,
    });

    this.logger.log(`registered inventory device ${workspaceId}/${key} (${kind})`);
    return toDeviceDto(device);
  }

  async list(
    workspaceId: string,
    filter: { kind?: string; agentTarget?: boolean } = {}
  ): Promise<DeviceDto[]> {
    const devices = await this.models.inventoryDevice.list(workspaceId, filter);
    return devices.map(toDeviceDto);
  }

  async get(workspaceId: string, key: string): Promise<DeviceDto | null> {
    const device = await this.models.inventoryDevice.get(workspaceId, this.normalizeKey(key));
    return device ? toDeviceDto(device) : null;
  }

  async remove(workspaceId: string, key: string): Promise<number> {
    return this.models.inventoryDevice.delete(workspaceId, this.normalizeKey(key));
  }

  async recordStatus(
    workspaceId: string,
    key: string,
    body: DeviceStatusBody
  ): Promise<DeviceDto | null> {
    const state = body.state ?? 'unknown';
    if (!DEVICE_STATES.includes(state as never)) {
      throw new BadRequest(`state must be one of ${DEVICE_STATES.join(', ')}`);
    }

    const device = await this.models.inventoryDevice.updateStatus(
      workspaceId,
      this.normalizeKey(key),
      {
        state,
        statusDetail: body.statusDetail ?? null,
        version: body.version ?? null,
        // The CLI sends epoch seconds; a missing or unusable value means now.
        checkedAt: body.checkedAt ? new Date(body.checkedAt * 1000) : new Date(),
        checks: (Array.isArray(body.checks) ? body.checks : []) as never,
      }
    );
    if (device) {
      // The monitoring agent learns from every reading, whoever took it.
      this.event?.emit('inventory.device.status', {
        workspaceId,
        key: device.key,
        checks: (device.checks ?? []) as unknown[],
      });
    }
    return device ? toDeviceDto(device) : null;
  }
}

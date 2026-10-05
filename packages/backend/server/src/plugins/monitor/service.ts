import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Monitor } from '@prisma/client';

import {
  BadRequest,
  JobQueue,
  NotFound,
  OnEvent,
  OnJob,
  safeFetch,
} from '../../base';
import { DocWriter } from '../../core/doc';
import { NotificationService } from '../../core/notification/service';
import { PermissionAccess } from '../../core/permission';
import { DocMode, Models } from '../../models';
import { AgentPushService, InventoryJobService } from '../inventory';
import {
  blockLine,
  type Condition,
  evaluate,
  extract,
  type ExtractSpec,
  MAX_VALUE_CHARS,
} from './extract';

declare global {
  interface Jobs {
    'monitor.run': { monitorId: string };
  }
}

export type MonitorKind = 'check' | 'agent';
export type MonitorSource = 'url' | 'command';

export interface MonitorSpec {
  url?: string;
  command?: string;
  extract?: ExtractSpec;
  /** agent: what to do each run, and the device harness to do it with. */
  instructions?: string;
  model?: string;
  tools?: string[];
}

export interface MonitorAlerts {
  inApp?: boolean;
  push?: boolean;
  email?: boolean;
}

/** A check is cheap; an agent run costs model time, so it goes less often. */
export const MIN_INTERVAL_MINUTES: Record<MonitorKind, number> = {
  check: 5,
  agent: 60,
};
/** After this many failures in a row a monitor pauses itself. */
export const MAX_FAILURES = 5;
/** A device job that hasn't reported back in this long is given up on. */
const PENDING_STALE_MS = 2 * 60 * 60_000;
/** How much of a page or API response is read. */
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
/** Who the block's "Edited by" stamp names. */
const editorName = (monitor: Pick<Monitor, 'name'>) => `Monitor: ${monitor.name}`;

/**
 * Runs monitors and keeps their blocks current.
 *
 * A url check runs here. A command check and an agent run are device jobs:
 * this queues them and picks the result up when the device reports
 * (`inventory.job.finished`), so nothing waits on a device in between.
 */
@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);

  constructor(
    private readonly models: Models,
    private readonly writer: DocWriter,
    private readonly notifications: NotificationService,
    private readonly ac: PermissionAccess,
    private readonly jobs: InventoryJobService,
    private readonly queue: JobQueue,
    @Optional() private readonly push?: AgentPushService
  ) {}

  /** Queue a run now (the cron and "Run now" both come through here). */
  async schedule(monitorId: string) {
    await this.queue.add('monitor.run', { monitorId }, { jobId: monitorId });
  }

  @OnJob('monitor.run')
  async run({ monitorId }: Jobs['monitor.run']) {
    const monitor = await this.models.monitor.get(monitorId);
    if (!monitor) return;

    const now = new Date();
    // Book the next run first, so a slow or failing one never runs back to back.
    await this.models.monitor.update(monitor.id, {
      nextRunAt: new Date(now.getTime() + monitor.intervalMinutes * 60_000),
    });

    if (monitor.pendingJobId) {
      const stale =
        monitor.lastRunAt && now.getTime() - monitor.lastRunAt.getTime() > PENDING_STALE_MS;
      if (!stale) {
        this.logger.debug(`monitor ${monitor.id} still waiting on job ${monitor.pendingJobId}`);
        return;
      }
      await this.models.monitor.update(monitor.id, { pendingJobId: null });
    }

    const spec = monitor.spec as MonitorSpec;
    try {
      if (monitor.kind === 'check' && monitor.source === 'url') {
        const body = await this.fetch(spec.url ?? '');
        await this.record(monitor, extract(body, spec.extract ?? { type: 'number' }));
        return;
      }
      if (monitor.kind === 'check' && monitor.source === 'command') {
        await this.queueDeviceJob(monitor, {
          model: 'command',
          instructions: spec.command ?? '',
          agentName: monitor.name,
        });
        return;
      }
      if (monitor.kind === 'agent') {
        await this.queueDeviceJob(monitor, {
          model: spec.model ?? 'claude-code',
          instructions: agentInstructions(monitor, spec),
          tools: spec.tools ?? [],
          agentName: monitor.name,
        });
        return;
      }
      throw new Error(`Unknown monitor kind ${monitor.kind}/${monitor.source}`);
    } catch (err) {
      await this.fail(monitor, err);
    }
  }

  /** The page or API response, through the SSRF guard. */
  private async fetch(url: string): Promise<string> {
    if (!/^https?:\/\//i.test(url)) throw new Error('The URL must start with http(s)://');
    const response = await safeFetch(
      url,
      {
        headers: {
          // Some shops refuse a bare fetch; look like a browser asking for a page.
          'user-agent':
            'Mozilla/5.0 (compatible; NotesGraphMonitor/1.0; +https://notesgraph.com)',
          accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        },
      },
      { timeoutMs: 20_000, maxBytes: MAX_FETCH_BYTES }
    );
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return await response.text();
  }

  private async queueDeviceJob(
    monitor: Monitor,
    body: { model: string; instructions: string; agentName: string; tools?: string[] }
  ) {
    if (!monitor.deviceKey) throw new Error('No device chosen to run this on');
    const job = await this.jobs.enqueue(monitor.workspaceId, monitor.createdBy, monitor.deviceKey, {
      ...body,
      agentId: `monitor:${monitor.id}`,
      title: monitor.name,
      targetKind: 'block',
      docId: monitor.docId,
      blockId: monitor.blockId,
      context: `Monitor "${monitor.name}" on block ${monitor.blockId} of doc ${monitor.docId}.`,
    });
    await this.models.monitor.update(monitor.id, {
      pendingJobId: job.id,
      lastRunAt: new Date(),
    });
  }

  /** A device job ended: if a monitor was waiting on it, take its result. */
  @OnEvent('inventory.job.finished')
  async onJobFinished(event: Events['inventory.job.finished']) {
    const monitor = await this.models.monitor.findByPendingJob(event.jobId);
    if (!monitor) return;
    await this.models.monitor.update(monitor.id, { pendingJobId: null });
    try {
      if (event.status !== 'done') {
        throw new Error(event.error || `The device job was ${event.status}`);
      }
      const result = event.result ?? '';
      if (monitor.kind === 'agent') {
        // The agent wrote the block itself; its closing answer is the reading.
        const summary = result.trim() || '(no summary)';
        await this.record(monitor, summary.slice(0, MAX_VALUE_CHARS), { write: false });
        return;
      }
      const spec = monitor.spec as MonitorSpec;
      await this.record(monitor, extract(result, spec.extract ?? { type: 'text' }));
    } catch (err) {
      await this.fail(monitor, err);
    }
  }

  /**
   * A new value: write the block, keep a reading, and alert if the condition
   * says so. `write: false` when something else (an agent) already wrote it.
   */
  async record(monitor: Monitor, value: string, { write = true } = {}) {
    const previous = monitor.lastValue;
    const now = new Date();
    const verdict = evaluate(monitor.condition as unknown as Condition, value, previous);

    if (write) {
      const allowed = await this.ac
        .user(monitor.createdBy)
        .workspace(monitor.workspaceId)
        .doc(monitor.docId)
        .can('Doc.Update');
      if (!allowed) {
        throw new Error("You no longer have edit access to the monitored note");
      }
      await this.writer.updateBlock(
        monitor.workspaceId,
        monitor.docId,
        monitor.blockId,
        blockLine(monitor.name, value, previous, now),
        editorName(monitor),
        monitor.createdBy
      );
    }

    const alerted = verdict.alert ? await this.alert(monitor, value, previous, verdict.reason) : false;
    await this.models.monitor.addReading(monitor.id, {
      value,
      changed: previous !== null && previous !== value,
      alerted,
    });
    await this.models.monitor.update(monitor.id, {
      lastValue: value,
      lastRunAt: now,
      lastError: null,
      failureCount: 0,
    });
  }

  private async fail(monitor: Monitor, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const failures = monitor.failureCount + 1;
    const pause = failures >= MAX_FAILURES;
    this.logger.warn(`monitor ${monitor.id} failed (${failures}): ${message}`);
    await this.models.monitor.addReading(monitor.id, {
      value: null,
      error: message.slice(0, 1000),
      changed: false,
      alerted: false,
    });
    await this.models.monitor.update(monitor.id, {
      lastError: message.slice(0, 1000),
      lastRunAt: new Date(),
      failureCount: failures,
      ...(pause ? { enabled: false } : {}),
    });
    if (pause) {
      // Always in the bell: a monitor that stopped itself must not go unnoticed.
      await this.alert(
        { ...monitor, alerts: { inApp: true } },
        null,
        monitor.lastValue,
        `paused after ${MAX_FAILURES} failures: ${message.slice(0, 120)}`
      );
    }
  }

  /** Send the alerts the monitor asks for; true if any went out. */
  private async alert(
    monitor: Pick<
      Monitor,
      'id' | 'name' | 'workspaceId' | 'createdBy' | 'docId' | 'blockId' | 'alerts'
    >,
    value: string | null,
    previous: string | null,
    reason: string
  ): Promise<boolean> {
    const alerts = (monitor.alerts ?? {}) as MonitorAlerts;
    if (!alerts.inApp && !alerts.push && !alerts.email) return false;
    try {
      if (alerts.inApp || alerts.email) {
        const meta = await this.models.doc.getMeta(monitor.workspaceId, monitor.docId, {
          select: { title: true },
        });
        await this.notifications.createMonitorAlert(
          {
            userId: monitor.createdBy,
            body: {
              workspaceId: monitor.workspaceId,
              createdByUserId: monitor.createdBy,
              monitorId: monitor.id,
              name: monitor.name,
              value,
              previous,
              reason,
              doc: {
                id: monitor.docId,
                title: meta?.title ?? '',
                mode: DocMode.page,
                blockId: monitor.blockId,
              },
            },
          },
          { email: !!alerts.email }
        );
      }
      if (alerts.push) {
        await this.push?.monitorAlert(monitor.createdBy, {
          monitorId: monitor.id,
          name: monitor.name,
          value: value ?? '',
          reason,
          workspaceId: monitor.workspaceId,
          docId: monitor.docId,
          blockId: monitor.blockId,
        });
      }
      return true;
    } catch (err) {
      // An alert that can't go out is no reason to lose the reading.
      this.logger.warn(`monitor ${monitor.id} alert failed: ${(err as Error).message}`);
      return false;
    }
  }

  /** Check a definition before it is saved; throws a BadRequest saying what's wrong. */
  validate(input: {
    kind: string;
    source?: string | null;
    deviceKey?: string | null;
    spec: MonitorSpec;
    intervalMinutes: number;
  }) {
    const kind = input.kind as MonitorKind;
    if (kind !== 'check' && kind !== 'agent') {
      throw new BadRequest("kind must be 'check' or 'agent'");
    }
    const minimum = MIN_INTERVAL_MINUTES[kind];
    if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < minimum) {
      throw new BadRequest(`A ${kind} runs at most every ${minimum} minutes`);
    }
    if (kind === 'check') {
      if (input.source === 'url') {
        if (!/^https?:\/\//i.test(input.spec.url ?? '')) {
          throw new BadRequest('A URL check needs an http(s):// URL');
        }
      } else if (input.source === 'command') {
        if (!input.spec.command?.trim()) throw new BadRequest('A command check needs a command');
        if (!input.deviceKey) throw new BadRequest('A command check needs a device');
      } else {
        throw new BadRequest("A check's source must be 'url' or 'command'");
      }
      const type = input.spec.extract?.type ?? 'number';
      if (!['number', 'regex', 'jsonpath', 'text'].includes(type)) {
        throw new BadRequest('extract.type must be number, regex, jsonpath or text');
      }
      if ((type === 'regex' || type === 'jsonpath') && !input.spec.extract?.pattern) {
        throw new BadRequest(`A ${type} extractor needs a pattern`);
      }
    } else {
      if (!input.spec.instructions?.trim()) throw new BadRequest('An agent monitor needs instructions');
      if (!input.deviceKey) throw new BadRequest('An agent monitor needs a device');
    }
  }

  /** A url check run once without saving anything, for "Test now". */
  async test(spec: MonitorSpec): Promise<string> {
    if (!spec.url) throw new BadRequest('Only a URL check can be tested here');
    try {
      return extract(await this.fetch(spec.url), spec.extract ?? { type: 'number' });
    } catch (err) {
      throw new BadRequest((err as Error).message);
    }
  }

  async getOwned(workspaceId: string, userId: string, id: string) {
    const monitor = await this.models.monitor.get(id);
    if (!monitor || monitor.workspaceId !== workspaceId || monitor.createdBy !== userId) {
      throw new NotFound('No such monitor');
    }
    return monitor;
  }
}

/**
 * What an agent monitor is told each run: its own instructions, and to keep
 * the one block current through NotesGraph's update_block tool.
 */
export function agentInstructions(monitor: Pick<Monitor, 'docId' | 'blockId' | 'name'>, spec: MonitorSpec) {
  return [
    (spec.instructions ?? '').trim(),
    '',
    `This is a scheduled run of the monitor "${monitor.name}". Keep one block`,
    `up to date: block ${monitor.blockId} in doc ${monitor.docId}. When you`,
    'have the answer, replace that block\'s text with a short summary of it',
    '(one line, with the key numbers and the source) using the NotesGraph',
    'update_block tool. Do not ask questions; work with what you can find.',
    'Finish with that same one-line summary.',
  ].join('\n');
}

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type {
  MonitoringAgent,
  MonitoringBaseline,
  MonitoringDecision,
  Prisma,
} from '@prisma/client';

import { BadRequest, NotFound, OnEvent } from '../../base';
import { Models } from '../../models';
import {
  ALPHA,
  type Baseline,
  type Finding,
  learn,
  round,
  type Severity,
  WARMUP,
} from './baseline';
import { InventoryHealthService } from './health';
import {
  acceptPattern,
  ingestLogs,
  LOG_METRIC_PREFIX,
  type LogCatalogDto,
  type LogPattern,
  type LogPatternDto,
  readCatalog,
  toLogPatternDto,
} from './log-patterns';
import { InventoryJobService } from './jobs';
import { AgentPushService } from './push';

/**
 * The monitoring agent: "learn what normal looks like, flag what's new,
 * escalate only what matters" (after VersusControl's devops-ai-guidelines,
 * ch. 4), applied to the inventory machines' health checks.
 *
 * - Every numeric reading (disk, memory, load, or anything the wf CLI sends
 *   with a value) gets an EWMA baseline per machine. A reading too many
 *   standard deviations above it is an anomaly; no thresholds to write.
 * - A warn or fail state a machine has never been in before is new. One it
 *   has been in before is known, and isn't news twice.
 * - It earns trust in three modes: training (learn only), shadow (decide and
 *   log, tell nobody) and detect (escalate: push, and optionally a read-only
 *   Claude run on the machine to triage).
 * - Repeats are folded: the same finding on the same machine is escalated
 *   once per COOLDOWN unless it gets worse or was marked resolved.
 * - "Expected" on a finding teaches the baseline that reading is normal.
 */

export { ALPHA, type Baseline, type Finding, learn, type Severity, WARMUP };

export const AGENT_MODES = ['training', 'shadow', 'detect'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** The same finding isn't escalated again inside this, unless it got worse. */
export const COOLDOWN_MS = 6 * 60 * 60_000;
/** Key of the per-machine counter of health checks seen. */
const HEALTH_SEEN = 'seen:health';
const TRIAGE_AGENT_PREFIX = 'triage:';
const MAX_TRIAGE_CHARS = 4000;
const MIN_INTERVAL = 15;

/**
 * Readings the agent knows the shape of. Only a rise is bad, and a standard
 * deviation never counts as smaller than `minStd`, so a flat baseline (a disk
 * at 41% for a week) isn't alarmed by 42%.
 */
const KNOWN_METRICS: Record<string, { label: string; unit?: string; minStd: number; upOnly: boolean }> = {
  disk: { label: 'Disk', unit: '%', minStd: 2, upOnly: true },
  memory: { label: 'Memory', unit: '%', minStd: 5, upOnly: true },
  load: { label: 'Load', minStd: 0.25, upOnly: true },
};

export interface Reading {
  metric: string;
  label: string;
  value: number;
}

export interface CheckState {
  name: string;
  status: 'ok' | 'warn' | 'fail';
}

const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * The checks as the agent reads them. The wf CLI writes its own shape, so
 * anything with a name is taken and its status read loosely (as the
 * Monitoring page does).
 */
export function readChecks(raw: unknown[]): { readings: Reading[]; states: CheckState[] } {
  const readings: Reading[] = [];
  const states: CheckState[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const check = item as Record<string, unknown>;
    const name = String(check.name ?? check.check ?? check.id ?? '').trim();
    if (!name) continue;
    const status = String(
      check.status ?? check.state ?? (check.ok === false ? 'fail' : 'ok')
    ).toLowerCase();
    states.push({
      name,
      status: ['fail', 'failed', 'error'].includes(status)
        ? 'fail'
        : ['warn', 'warning', 'degraded'].includes(status)
          ? 'warn'
          : 'ok',
    });
    if (typeof check.value === 'number' && Number.isFinite(check.value)) {
      readings.push({ metric: slug(name), label: name, value: check.value });
    }
  }
  return { readings, states };
}

/** The smallest standard deviation a baseline is given credit for. */
export function minStd(metric: string, mean: number) {
  return KNOWN_METRICS[metric]?.minStd ?? Math.max(Math.abs(mean) * 0.05, 0.1);
}

/** How many standard deviations a reading is from normal; signed. */
export function score(baseline: Baseline, metric: string, value: number) {
  const std = Math.max(Math.sqrt(baseline.variance), minStd(metric, baseline.mean));
  return (value - baseline.mean) / std;
}

/** A reading's finding, if it is far enough from what this machine does. */
export function judge(
  reading: Reading,
  baseline: Baseline | null,
  sensitivity: number
): Finding | null {
  if (!baseline || baseline.samples < WARMUP) return null;
  const z = score(baseline, reading.metric, reading.value);
  const upOnly = KNOWN_METRICS[reading.metric]?.upOnly ?? false;
  if ((upOnly ? z : Math.abs(z)) < sensitivity) return null;
  const unit = KNOWN_METRICS[reading.metric]?.unit ?? '';
  return {
    metric: reading.metric,
    kind: 'anomaly',
    severity: Math.abs(z) >= sensitivity * 2 ? 'critical' : 'warn',
    value: reading.value,
    baseline: round(baseline.mean),
    score: round(z),
    summary:
      `${reading.label} is ${round(reading.value)}${unit}; ` +
      `normal here is about ${round(baseline.mean)}${unit} ` +
      `(${round(Math.abs(z))}σ ${z > 0 ? 'above' : 'below'})`,
  };
}

/**
 * What one health check teaches the agent and what it found: the baselines
 * to save and the findings. Pure, so the learning is testable on its own.
 */
export function assess(
  checks: unknown[],
  baselines: Map<string, Baseline>,
  sensitivity: number
): { updates: Map<string, Baseline>; findings: Finding[] } {
  const { readings, states } = readChecks(checks);
  const updates = new Map<string, Baseline>();
  const findings: Finding[] = [];

  for (const reading of readings) {
    const baseline = baselines.get(reading.metric) ?? null;
    const finding = judge(reading, baseline, sensitivity);
    if (finding) findings.push(finding);
    // An anomaly is learned slowly, so one bad hour doesn't become normal,
    // but a lasting shift (a bigger dataset on disk) still does in time.
    updates.set(reading.metric, learn(baseline, reading.value, finding ? ALPHA / 4 : ALPHA));
  }

  const machineSeen = baselines.get(HEALTH_SEEN)?.samples ?? 0;
  for (const state of states) {
    if (state.status === 'ok') continue;
    const key = `seen:${state.name}:${state.status}`;
    const seen = baselines.get(key);
    // Only once the machine is known: during its first checks everything is new.
    if (machineSeen >= WARMUP && !seen?.samples) {
      findings.push({
        metric: key,
        kind: 'new',
        severity: state.status === 'fail' ? 'critical' : 'warn',
        value: null,
        baseline: null,
        score: null,
        summary: `${state.name} is ${state.status === 'fail' ? 'failing' : 'warning'}, which this machine has not done before`,
      });
    }
    updates.set(key, {
      mean: 0,
      variance: 0,
      samples: (seen?.samples ?? 0) + 1,
      lastValue: null,
    });
  }
  updates.set(HEALTH_SEEN, {
    mean: 0,
    variance: 0,
    samples: machineSeen + 1,
    lastValue: null,
  });

  return { updates, findings };
}

const RANK: Record<string, number> = { warn: 1, critical: 2 };

/** Whether an earlier decision already covers this finding. */
export function isRepeat(
  finding: Pick<Finding, 'severity'>,
  last: Pick<MonitoringDecision, 'severity' | 'verdict' | 'createdAt'> | null,
  now: number
) {
  if (!last || last.verdict === 'resolved' || last.verdict === 'expected') return false;
  if (now - last.createdAt.getTime() > COOLDOWN_MS) return false;
  return (RANK[finding.severity] ?? 0) <= (RANK[last.severity] ?? 0);
}

/** What a triage run is told: look, don't touch, and say what you found. */
export function triageInstructions(
  device: { key: string; name: string },
  decision: Pick<MonitoringDecision, 'summary' | 'metric' | 'kind' | 'severity'>
) {
  return [
    `You are an SRE triaging an alert on the machine "${device.name}" (${device.key}), which you are running on.`,
    '',
    `Alert (${decision.severity}, ${decision.kind}): ${decision.summary}.`,
    '',
    'Investigate with read-only commands only (for example df -h, du -sh, free, uptime,',
    'top -b -n1 or ps aux --sort=-%cpu, journalctl -p err --since "-2h", docker ps / docker stats --no-stream).',
    'Do not change, delete, restart or install anything, and do not ask questions.',
    '',
    'Finish with a short triage, under 120 words, in plain text:',
    'Likely cause: …',
    'Evidence: … (the numbers or log lines that show it)',
    'Suggested fix: … (what a person should do; you do not do it)',
    'Urgency: now / today / can wait',
  ].join('\n');
}

export interface AgentSettings {
  mode?: string;
  sensitivity?: number;
  intervalMinutes?: number;
  autoTriage?: boolean;
  alerts?: { push?: boolean };
}

export interface AgentDto {
  enabled: boolean;
  mode: AgentMode;
  sensitivity: number;
  intervalMinutes: number;
  autoTriage: boolean;
  alerts: { push: boolean };
  /** Epoch seconds. */
  lastRunAt: number | null;
  nextRunAt: number | null;
  /** Per machine: health checks seen, and readings still learning. */
  learning: { deviceKey: string; checks: number; metrics: { metric: string; mean: number; std: number; samples: number }[] }[];
}

export interface DecisionDto {
  id: string;
  deviceKey: string;
  metric: string;
  kind: string;
  severity: string;
  value: number | null;
  baseline: number | null;
  score: number | null;
  summary: string;
  action: string;
  verdict: string | null;
  triageJobId: string | null;
  triage: string | null;
  createdAt: number;
}

const toDecisionDto = (row: MonitoringDecision): DecisionDto => ({
  id: row.id,
  deviceKey: row.deviceKey,
  metric: row.metric,
  kind: row.kind,
  severity: row.severity,
  value: row.value,
  baseline: row.baseline,
  score: row.score,
  summary: row.summary,
  action: row.action,
  verdict: row.verdict,
  triageJobId: row.triageJobId,
  triage: row.triage,
  createdAt: row.createdAt.getTime() / 1000,
});

const asMode = (mode: string): AgentMode =>
  (AGENT_MODES as readonly string[]).includes(mode) ? (mode as AgentMode) : 'training';

@Injectable()
export class MonitoringAgentService {
  private readonly logger = new Logger(MonitoringAgentService.name);

  constructor(
    private readonly models: Models,
    private readonly jobs: InventoryJobService,
    private readonly health: InventoryHealthService,
    @Optional() private readonly push?: AgentPushService
  ) {}

  async get(workspaceId: string): Promise<AgentDto> {
    const [agent, baselines] = await Promise.all([
      this.models.monitoringAgent.get(workspaceId),
      this.models.monitoringAgent.listBaselines(workspaceId),
    ]);
    return this.toDto(agent, baselines);
  }

  private toDto(agent: MonitoringAgent | null, baselines: MonitoringBaseline[]): AgentDto {
    const byDevice = new Map<string, AgentDto['learning'][number]>();
    for (const row of baselines) {
      let entry = byDevice.get(row.deviceKey);
      if (!entry) {
        entry = { deviceKey: row.deviceKey, checks: 0, metrics: [] };
        byDevice.set(row.deviceKey, entry);
      }
      if (row.metric === HEALTH_SEEN) entry.checks = row.samples;
      else if (!row.metric.startsWith('seen:')) {
        entry.metrics.push({
          metric: row.metric,
          mean: round(row.mean),
          std: round(Math.sqrt(row.variance)),
          samples: row.samples,
        });
      }
    }
    const alerts = (agent?.alerts ?? {}) as { push?: boolean };
    return {
      enabled: !!agent,
      mode: asMode(agent?.mode ?? 'training'),
      sensitivity: agent?.sensitivity ?? 3,
      intervalMinutes: agent?.intervalMinutes ?? 60,
      autoTriage: agent?.autoTriage ?? false,
      alerts: { push: !!alerts.push },
      lastRunAt: agent?.lastRunAt ? agent.lastRunAt.getTime() / 1000 : null,
      nextRunAt: agent && agent.intervalMinutes > 0 ? agent.nextRunAt.getTime() / 1000 : null,
      learning: [...byDevice.values()],
    };
  }

  /** Turn the agent on, or change it. It acts as whoever changed it last. */
  async configure(workspaceId: string, userId: string, body: AgentSettings): Promise<AgentDto> {
    const data: Parameters<Models['monitoringAgent']['upsert']>[1] = { updatedBy: userId };
    if (body.mode !== undefined) {
      if (!(AGENT_MODES as readonly string[]).includes(body.mode)) {
        throw new BadRequest(`mode must be one of ${AGENT_MODES.join(', ')}`);
      }
      data.mode = body.mode;
    }
    if (body.sensitivity !== undefined) {
      const sensitivity = Number(body.sensitivity);
      if (!Number.isFinite(sensitivity) || sensitivity < 1.5 || sensitivity > 10) {
        throw new BadRequest('sensitivity must be between 1.5 and 10');
      }
      data.sensitivity = sensitivity;
    }
    if (body.intervalMinutes !== undefined) {
      const minutes = Number(body.intervalMinutes);
      if (!Number.isInteger(minutes) || (minutes !== 0 && minutes < MIN_INTERVAL)) {
        throw new BadRequest(`intervalMinutes must be 0 (never) or at least ${MIN_INTERVAL}`);
      }
      data.intervalMinutes = minutes;
      data.nextRunAt = new Date(Date.now() + minutes * 60_000);
    }
    if (body.autoTriage !== undefined) data.autoTriage = !!body.autoTriage;
    if (body.alerts !== undefined) data.alerts = { push: !!body.alerts.push };
    await this.models.monitoringAgent.upsert(workspaceId, data);
    return await this.get(workspaceId);
  }

  /** Forget what was learned; it starts over in training. */
  async reset(workspaceId: string, userId: string, deviceKey?: string) {
    const cleared =
      (await this.models.monitoringAgent.clearBaselines(workspaceId, deviceKey)) +
      (await this.models.monitoringAgent.clearLogCatalogs(workspaceId, deviceKey));
    if (!deviceKey) {
      await this.models.monitoringAgent.upsert(workspaceId, { updatedBy: userId, mode: 'training' });
    }
    return { cleared, agent: await this.get(workspaceId) };
  }

  async decisions(workspaceId: string, limit = 100): Promise<DecisionDto[]> {
    const rows = await this.models.monitoringAgent.listDecisions(
      workspaceId,
      Math.min(Math.max(limit, 1), 500)
    );
    return rows.map(toDecisionDto);
  }

  /** A machine reported: learn from it, and act on what's new. */
  @OnEvent('inventory.device.status')
  async onDeviceStatus(event: Events['inventory.device.status']) {
    try {
      await this.observe(event.workspaceId, event.key, event.checks);
    } catch (err) {
      this.logger.warn(
        `monitoring agent could not read ${event.workspaceId}/${event.key}: ${(err as Error).message}`
      );
    }
  }

  async observe(workspaceId: string, deviceKey: string, checks: unknown[]) {
    const agent = await this.models.monitoringAgent.get(workspaceId);
    if (!agent) return [];

    const rows = await this.models.monitoringAgent.listBaselines(workspaceId, deviceKey);
    const baselines = new Map<string, Baseline>(rows.map(row => [row.metric, row]));
    const { updates, findings } = assess(checks, baselines, agent.sensitivity);
    for (const [metric, baseline] of updates) {
      await this.models.monitoringAgent.saveBaseline(workspaceId, deviceKey, metric, baseline);
    }

    return await this.decide(agent, deviceKey, findings);
  }

  /** A machine's log lines arrived: fold them into its catalog of patterns. */
  @OnEvent('inventory.device.logs')
  async onDeviceLogs(event: Events['inventory.device.logs']) {
    try {
      await this.observeLogs(event.workspaceId, event.key, event.lines, event.until);
    } catch (err) {
      this.logger.warn(
        `monitoring agent could not read logs of ${event.workspaceId}/${event.key}: ${(err as Error).message}`
      );
    }
  }

  /** `until` is epoch seconds: the end of the time the lines cover. */
  async observeLogs(workspaceId: string, deviceKey: string, lines: string[], until: number) {
    const agent = await this.models.monitoringAgent.get(workspaceId);
    if (!agent) return [];

    const row = await this.models.monitoringAgent.getLogCatalog(workspaceId, deviceKey);
    const from = row?.scannedAt ? row.scannedAt.getTime() / 1000 : until - 3600;
    const scan = ingestLogs(readCatalog(row?.patterns), lines, {
      scans: row?.scans ?? 0,
      hours: (until - from) / 3600,
      now: until,
      sensitivity: agent.sensitivity,
    });
    await this.models.monitoringAgent.saveLogCatalog(workspaceId, deviceKey, {
      patterns: scan.patterns as unknown as Prisma.InputJsonValue,
      scans: (row?.scans ?? 0) + 1,
      scannedAt: new Date(until * 1000),
    });
    return await this.decide(agent, deviceKey, scan.findings);
  }

  /** Record what was found, in shadow or detect; escalate it in detect. */
  private async decide(agent: MonitoringAgent, deviceKey: string, findings: Finding[]) {
    const { workspaceId } = agent;
    const mode = asMode(agent.mode);
    if (mode === 'training') return [];

    const now = Date.now();
    const recorded: MonitoringDecision[] = [];
    for (const finding of findings) {
      const last = await this.models.monitoringAgent.lastDecision(workspaceId, deviceKey, finding.metric);
      if (isRepeat(finding, last, now)) continue;
      const decision = await this.models.monitoringAgent.addDecision({
        workspaceId,
        deviceKey,
        ...finding,
        action: mode === 'detect' ? 'escalated' : 'shadow',
      });
      recorded.push(decision);
      if (mode === 'detect') await this.escalate(agent, decision);
    }
    return recorded;
  }

  private async escalate(agent: MonitoringAgent, decision: MonitoringDecision) {
    const alerts = (agent.alerts ?? {}) as { push?: boolean };
    if (alerts.push) {
      try {
        const device = await this.models.inventoryDevice.get(agent.workspaceId, decision.deviceKey);
        // The phone already shows monitor alerts; this rides on the same type.
        await this.push?.monitorAlert(agent.updatedBy, {
          monitorId: `agent:${decision.deviceKey}:${decision.metric}`,
          name: `${device?.name ?? decision.deviceKey}: ${decision.severity}`,
          value: '',
          reason: decision.summary,
          workspaceId: agent.workspaceId,
          docId: '',
          blockId: '',
        });
      } catch (err) {
        this.logger.warn(`monitoring alert push failed: ${(err as Error).message}`);
      }
    }
    if (agent.autoTriage) {
      try {
        await this.triage(agent.workspaceId, agent.updatedBy, decision.id);
      } catch (err) {
        // A machine that doesn't take jobs still gets the alert.
        await this.models.monitoringAgent.updateDecision(decision.id, {
          triage: `Couldn't start a triage run: ${(err as Error).message}`.slice(0, MAX_TRIAGE_CHARS),
        });
      }
    }
  }

  /** Send a read-only Claude run to the machine to find out why. */
  async triage(workspaceId: string, userId: string, decisionId: string): Promise<DecisionDto> {
    const decision = await this.models.monitoringAgent.getDecision(workspaceId, decisionId);
    if (!decision) throw new NotFound('No such decision');
    if (decision.triageJobId && !decision.triage) {
      // One already out: don't send a second.
      return toDecisionDto(decision);
    }
    const device = await this.models.inventoryDevice.get(workspaceId, decision.deviceKey);
    if (!device) throw new BadRequest(`No device '${decision.deviceKey}' in this workspace`);
    const job = await this.jobs.enqueue(workspaceId, userId, decision.deviceKey, {
      model: 'claude-code',
      instructions: triageInstructions(device, decision),
      agentId: TRIAGE_AGENT_PREFIX + decision.id,
      agentName: 'Monitoring triage',
      title: `Triage: ${device.name}: ${decision.summary}`.slice(0, 200),
      context: `Monitoring agent decision ${decision.id} on ${device.key}.`,
    });
    const updated = await this.models.monitoringAgent.updateDecision(decision.id, {
      triageJobId: job.id,
      triage: null,
    });
    return toDecisionDto(updated);
  }

  /** A triage run ended: keep what it found on the decision. */
  @OnEvent('inventory.job.finished')
  async onJobFinished(event: Events['inventory.job.finished']) {
    const decision = await this.models.monitoringAgent.findByTriageJob(event.jobId);
    if (!decision) return;
    const text =
      event.status === 'done'
        ? (event.result ?? '').trim() || '(the triage run said nothing)'
        : `Triage run ${event.status}: ${event.error ?? 'no detail'}`;
    await this.models.monitoringAgent.updateDecision(decision.id, {
      triage: text.slice(0, MAX_TRIAGE_CHARS),
    });
  }

  /**
   * The person's word on a decision. "expected" teaches the baseline that
   * reading is normal for this machine; "resolved" lets it alert again.
   */
  async feedback(workspaceId: string, decisionId: string, verdict: string): Promise<DecisionDto> {
    if (verdict !== 'expected' && verdict !== 'resolved') {
      throw new BadRequest("verdict must be 'expected' or 'resolved'");
    }
    const decision = await this.models.monitoringAgent.getDecision(workspaceId, decisionId);
    if (!decision) throw new NotFound('No such decision');
    const logPattern = decision.metric.startsWith(LOG_METRIC_PREFIX)
      ? decision.metric.slice(LOG_METRIC_PREFIX.length)
      : null;
    if (verdict === 'expected' && logPattern) {
      // A new line, or one logged far more than usual: this pattern, at this rate, is normal.
      await this.updatePattern(workspaceId, decision.deviceKey, logPattern, pattern =>
        acceptPattern(pattern, decision.kind === 'anomaly' ? decision.value : null)
      );
    } else if (verdict === 'expected' && decision.kind === 'anomaly' && decision.value !== null) {
      const rows = await this.models.monitoringAgent.listBaselines(workspaceId, decision.deviceKey);
      const baseline = rows.find(row => row.metric === decision.metric) ?? null;
      // Half the way there, and a wider spread: normal now includes it.
      const next = learn(baseline, decision.value, 0.5);
      next.variance = Math.max(next.variance, ((decision.value - next.mean) / 2) ** 2);
      await this.models.monitoringAgent.saveBaseline(workspaceId, decision.deviceKey, decision.metric, next);
    }
    const updated = await this.models.monitoringAgent.updateDecision(decision.id, { verdict });
    return toDecisionDto(updated);
  }

  /** What each machine's logs are known to say: its catalog of patterns, most seen first. */
  async logPatterns(workspaceId: string): Promise<LogCatalogDto[]> {
    const rows = await this.models.monitoringAgent.listLogCatalogs(workspaceId);
    return rows.map(row => ({
      deviceKey: row.deviceKey,
      scans: row.scans,
      scannedAt: row.scannedAt ? row.scannedAt.getTime() / 1000 : null,
      patterns: readCatalog(row.patterns)
        .map(toLogPatternDto)
        .sort((a, b) => b.count - a.count),
    }));
  }

  /** A person's label on a pattern: 'known' (never news) or null (judge it again). */
  async labelPattern(
    workspaceId: string,
    deviceKey: string,
    patternId: string,
    label: string | null
  ): Promise<LogPatternDto> {
    if (label !== null && label !== 'known') {
      throw new BadRequest("label must be 'known' or null");
    }
    const pattern = await this.updatePattern(workspaceId, deviceKey, patternId, pattern => ({
      ...pattern,
      label,
    }));
    return toLogPatternDto(pattern);
  }

  private async updatePattern(
    workspaceId: string,
    deviceKey: string,
    patternId: string,
    change: (pattern: LogPattern) => LogPattern
  ) {
    const row = await this.models.monitoringAgent.getLogCatalog(workspaceId, deviceKey);
    const patterns = readCatalog(row?.patterns);
    const at = patterns.findIndex(pattern => pattern.id === patternId);
    // The catalog drops patterns not seen for long; there is nothing left to teach then.
    if (!row || at < 0) throw new NotFound('That log pattern is no longer in the catalog');
    patterns[at] = change(patterns[at]);
    await this.models.monitoringAgent.saveLogCatalog(workspaceId, deviceKey, {
      patterns: patterns as unknown as Prisma.InputJsonValue,
      scans: row.scans,
      scannedAt: row.scannedAt,
    });
    return patterns[at];
  }

  /** Agents due to check their machines do so; the results come back as status events. */
  @Cron(CronExpression.EVERY_MINUTE)
  async pollAgents() {
    const due = await this.models.monitoringAgent.listDue(new Date(), 50);
    await Promise.allSettled(
      due.map(async agent => {
        const now = new Date();
        await this.models.monitoringAgent.touch(agent.workspaceId, {
          lastRunAt: now,
          nextRunAt: new Date(now.getTime() + agent.intervalMinutes * 60_000),
        });
        await this.health.checkAll(agent.workspaceId, agent.updatedBy);
      })
    );
  }
}

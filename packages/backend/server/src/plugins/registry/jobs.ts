import { Injectable, Logger, Optional } from '@nestjs/common';
import type { RegistryJob, RegistryJobQuestion } from '@prisma/client';

// See the note in service.ts: a plain HttpException is reported as a 500 by
// the global filter, so bad input has to be a UserFriendlyError.
import { ActionForbidden, BadRequest, EventBus, NotFound } from '../../base';
import { Models } from '../../models';
import {
  JOB_TERMINAL,
  QUESTION_KINDS,
  type QuestionKind,
  STEER_KIND,
} from '../../models/registry-job';
import { AgentMemoryService } from './agent-memory';
import {
  type AgentProfile,
  alwaysAsks,
  parseAccess,
  profileFor,
} from './agent-profiles';
import { AgentRules, withAgentRules } from './agent-rules';
import { AgentPushService } from './push';
import { isSessionLimit, sessionLimitRunAfter } from './session-limit';
import { SkillNoteService } from './skill-notes';
import { JobTaskClaims } from './task-claims';

declare global {
  interface Events {
    /** A device job reached done, error or cancelled. */
    'registry.job.finished': {
      workspaceId: string;
      jobId: string;
      status: string;
      result: string | null;
      error: string | null;
    };
  }
}

/** Wire shape for a job. Epoch seconds, matching the device DTO. */
export interface JobDto {
  id: string;
  deviceKey: string;
  agentId: string;
  agentName: string;
  instructions: string;
  context: string;
  model: string | null;
  tools: unknown[];
  maxSteps: number;
  targetKind: string | null;
  docId: string | null;
  blockId: string | null;
  /** What the run is about; null when neither the starter nor the agent named it. */
  title: string | null;
  /** Task blocks in `docId` the run is on; see task-claims.ts. */
  taskIds: string[];
  status: string;
  result: string | null;
  error: string | null;
  steps: number;
  /** What the run cost (USD) and the tokens it used, once its runner says. */
  costUsd: number | null;
  tokens: number | null;
  /** The run stops once it has spent this much (USD); null for no cap. */
  maxCostUsd: number | null;
  /** The agent's permission level; null for its profile's own tool list. */
  access: string | null;
  /** Device-side tmux session the run is in, for `tmux attach -t`. */
  tmuxSession: string | null;
  claimedBy: string | null;
  /** A queued job waits until this (the session limit's reset), if set. */
  runAfter: number | null;
  /**
   * When the runner holding a running job must next report by. Past it, the
   * runner has gone quiet (crashed, asleep, offline) and the job is waiting
   * to be claimed again.
   */
  leaseExpiresAt: number | null;
  /** "Allow all": every permission the run asks is allowed without asking. */
  allowAllTools: boolean;
  /**
   * Transcript text from absolute offset `logFrom` to `logEnd`. Omitted from
   * listings, which would otherwise ship every job's transcript at once.
   */
  log?: string;
  logFrom?: number;
  logEnd?: number;
  /** Everything the run has asked, open ones last. Single-job reads only. */
  questions?: QuestionDto[];
  /** What the person sent the run while it worked. Single-job reads only. */
  steers?: SteerDto[];
  /**
   * How to run it, for the runner that claimed it (see agent-profiles.ts);
   * null for a model that isn't a Claude agent. Claims only.
   */
  profile?: AgentProfile | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface QuestionDto {
  id: string;
  kind: string;
  text: string;
  detail: string | null;
  /** For a question: choices offered; empty means free text only. */
  options: string[];
  answer: string | null;
  allowed: boolean | null;
  createdAt: number;
  answeredAt: number | null;
}

export function toQuestionDto(question: RegistryJobQuestion): QuestionDto {
  return {
    id: question.id,
    kind: question.kind,
    text: question.text,
    detail: question.detail,
    options: question.options ?? [],
    answer: question.answer,
    allowed: question.allowed,
    createdAt: question.createdAt.getTime() / 1000,
    answeredAt: question.answeredAt ? question.answeredAt.getTime() / 1000 : null,
  };
}

/** A message sent to a running job; `deliveredAt` once its runner took it. */
export interface SteerDto {
  id: string;
  text: string;
  createdAt: number;
  deliveredAt: number | null;
}

export function toSteerDto(steer: RegistryJobQuestion): SteerDto {
  return {
    id: steer.id,
    text: steer.text,
    createdAt: steer.createdAt.getTime() / 1000,
    deliveredAt: steer.answeredAt ? steer.answeredAt.getTime() / 1000 : null,
  };
}

export interface JobDtoOptions {
  /** Include the transcript, starting at this absolute offset (0 = all kept). */
  logFrom?: number;
  questions?: RegistryJobQuestion[];
}

export function toJobDto(job: RegistryJob, options: JobDtoOptions = {}): JobDto {
  return {
    id: job.id,
    deviceKey: job.deviceKey,
    agentId: job.agentId,
    agentName: job.agentName,
    instructions: job.instructions,
    context: job.context,
    model: job.model,
    tools: (job.tools ?? []) as unknown[],
    maxSteps: job.maxSteps,
    targetKind: job.targetKind,
    docId: job.docId,
    blockId: job.blockId,
    title: job.title,
    taskIds: job.taskIds ?? [],
    status: job.status,
    result: job.result,
    error: job.error,
    steps: job.steps,
    costUsd: job.costUsd,
    tokens: job.tokens,
    maxCostUsd: job.maxCostUsd,
    access: job.access,
    tmuxSession: job.tmuxSession,
    claimedBy: job.claimedBy,
    runAfter: job.runAfter ? job.runAfter.getTime() / 1000 : null,
    leaseExpiresAt: job.leaseExpiresAt ? job.leaseExpiresAt.getTime() / 1000 : null,
    allowAllTools: job.allowAllTools,
    ...(options.logFrom === undefined ? {} : sliceLog(job, options.logFrom)),
    // Steers share the questions table but are no question: anything reading
    // `questions` for what the run waits on must not see them.
    ...(options.questions
      ? {
          questions: options.questions
            .filter(q => q.kind !== STEER_KIND)
            .map(toQuestionDto),
          steers: options.questions
            .filter(q => q.kind === STEER_KIND)
            .map(toSteerDto),
        }
      : {}),
    createdAt: job.createdAt.getTime() / 1000,
    startedAt: job.startedAt ? job.startedAt.getTime() / 1000 : null,
    finishedAt: job.finishedAt ? job.finishedAt.getTime() / 1000 : null,
  };
}

/**
 * The part of a job's transcript at or after `from`.
 *
 * Offsets count code points, not UTF-16 units, because that is what
 * Postgres LENGTH() counts when the append trims the head; counting JS
 * string length instead would drift by one per emoji.
 */
function sliceLog(job: RegistryJob, from: number) {
  const chars = Array.from(job.log);
  const start = Math.max(0, Math.floor(from) - job.logDropped);
  return {
    log: chars.slice(start).join(''),
    logFrom: job.logDropped + start,
    logEnd: job.logDropped + chars.length,
  };
}

const MAX_INSTRUCTIONS = 20_000;
const MAX_QUESTION = 4_000;
// A permission's detail is the tool input, which the page renders as a diff:
// clipped JSON no longer parses, so leave room for a whole file.
const MAX_DETAIL = 200_000;
const MAX_ANSWER = 20_000;
const MAX_OPTIONS = 10;
const MAX_OPTION = 500;

// The run's own tools only talk back to NotesGraph: naming the run or asking
// the person something. A runner that still puts them to the user (one
// started before they were pre-approved) gets them allowed here instead.
const ALWAYS_ALLOWED_PERMISSIONS = new Set([
  'Allow mcp__run__set_title?',
  'Allow mcp__run__ask_user?',
]);

/**
 * How long past its lease a running job's runner may be before the run's log
 * says it was lost. A little slack, so a runner renewing a moment late (or a
 * clock a second off) isn't reported as gone.
 */
const LEASE_LAPSE_GRACE_MS = 30_000;

/**
 * How long a run may sit queued before its log asks whether anything on the
 * device is listening, and how recently that device's runner must have asked
 * for work to count as listening (runners poll every few seconds).
 */
const UNCLAIMED_AFTER_MS = 60_000;
const RUNNER_QUIET_MS = 2 * 60_000;

/**
 * The transcript line for a queued run that no runner is picking up. `marker`
 * is part of it so the note is written once per job.
 */
function unclaimedNote(job: RegistryJob, host: string, runnerSeenAt: Date | null) {
  const marker = `Nothing on ${job.deviceKey} is picking up runs`;
  const seen = runnerSeenAt
    ? `its runner last asked for work at ${runnerSeenAt.toISOString()}`
    : 'no runner there has asked for work since this was first tracked';
  const where = host ? ` on ${host}` : '';
  const note =
    `⏳ ${marker}: ${seen}. Start one with \`wf agent serve\`${where} ` +
    `(or restart it if it stopped); this run starts as soon as it does.`;
  return { marker, note };
}

/**
 * The transcript line for a run whose runner stopped reporting. `marker` is
 * part of it so the note is written once per lapsed lease.
 */
function leaseLapsedNote(job: RegistryJob, lease: Date) {
  const marker = `lease ran out at ${lease.toISOString()}`;
  const runner = job.claimedBy ? `The runner (${job.claimedBy})` : 'The runner';
  const note =
    `⚠ Lost contact with ${job.deviceKey}. ${runner} stopped reporting ` +
    `and its ${marker}, so it most likely crashed, was stopped, or the ` +
    `machine went to sleep or offline. Nothing is working on this run now. ` +
    `If a runner on ${job.deviceKey} comes back it starts the run again ` +
    `from the beginning; otherwise stop the run.`;
  return { marker, note };
}

/** A question's choices: trimmed, non-empty, de-duplicated and capped. */
function parseOptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const options = value
    .map(option => String(option ?? '').trim().slice(0, MAX_OPTION))
    .filter(Boolean);
  return [...new Set(options)].slice(0, MAX_OPTIONS);
}
const MAX_CONTEXT = 200_000;
const MAX_TITLE = 200;
const MAX_TASKS = 200;

/** The task block ids a job is on: strings, de-duplicated and capped. */
function parseTaskIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids = value
    .filter((id): id is string => typeof id === 'string')
    .map(id => id.trim().slice(0, 200))
    .filter(Boolean);
  return [...new Set(ids)].slice(0, MAX_TASKS);
}

/** A positive amount of dollars, or null for none. */
function parseUsd(value: unknown): number | null {
  const usd = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(usd) && usd > 0
    ? Math.round(usd * 10_000) / 10_000
    : null;
}

/** The first moment of the current calendar month, UTC. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface AgentBudgetDto {
  /** Null: no budget, runs are never refused for cost. */
  monthlyUsd: number | null;
  /** What this month's runs have cost so far. */
  spentUsd: number;
  /** The month counted, as YYYY-MM (UTC). */
  month: string;
}

/** A run title on one line, or null when there is nothing left of it. */
function parseTitle(value: unknown): string | null {
  const title = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE);
  return title || null;
}

/**
 * Dispatching agent work to registered devices.
 *
 * Enqueue is the only privileged direction: it makes someone else's machine
 * run something. Claiming and reporting are the device's own side of a job
 * it was already given.
 */
@Injectable()
export class RegistryJobService {
  private readonly logger = new Logger(RegistryJobService.name);

  constructor(
    private readonly models: Models,
    @Optional() private readonly push?: AgentPushService,
    @Optional() private readonly event?: EventBus,
    @Optional() private readonly tasks?: JobTaskClaims,
    @Optional() private readonly rules?: AgentRules,
    @Optional() private readonly skillNotes?: SkillNoteService,
    @Optional() private readonly memory?: AgentMemoryService
  ) {}

  /** Push without holding up the request it rides on, or failing it. */
  private notify(send: (push: AgentPushService) => Promise<void>) {
    if (!this.push) return;
    send(this.push).catch(err => {
      this.logger.warn(`agent push failed: ${err}`);
    });
  }

  async enqueue(
    workspaceId: string,
    userId: string,
    deviceKey: string,
    body: Record<string, unknown>
  ): Promise<JobDto> {
    const device = await this.models.registryDevice.get(workspaceId, deviceKey);
    if (!device) {
      throw new BadRequest(`No device '${deviceKey}' in this workspace`);
    }
    // Registering a device is not consent to run code on it. That is a
    // separate opt-in, and it is checked here rather than in the UI so a
    // direct API call cannot skip it.
    if (!device.agentTarget) {
      throw new BadRequest(
        `Device '${deviceKey}' is not an agent target. Re-register it with agent execution allowed.`
      );
    }

    const instructions = String(body.instructions ?? '').trim();
    if (!instructions) {
      throw new BadRequest('instructions are required');
    }
    if (instructions.length > MAX_INSTRUCTIONS) {
      throw new BadRequest(`instructions exceed ${MAX_INSTRUCTIONS} characters`);
    }
    const context = String(body.context ?? '');
    if (context.length > MAX_CONTEXT) {
      throw new BadRequest(`context exceeds ${MAX_CONTEXT} characters`);
    }

    await this.checkBudget(workspaceId);
    const access = parseAccess(body.access);

    // A device that hit its session limit can't run anything until it
    // resets, so a job asked for meanwhile waits with the others.
    const runAfter = await this.models.registryJob.heldUntil(workspaceId, deviceKey);

    const docId = body.docId ? String(body.docId) : null;
    const job = await this.models.registryJob.create({
      workspaceId,
      deviceKey,
      agentId: String(body.agentId ?? ''),
      agentName: String(body.agentName ?? 'agent').slice(0, 200),
      instructions,
      context,
      model: body.model ? String(body.model) : null,
      tools: (Array.isArray(body.tools) ? body.tools : []) as never,
      maxSteps: Number(body.maxSteps ?? 8),
      targetKind: body.targetKind ? String(body.targetKind) : null,
      docId,
      blockId: body.blockId ? String(body.blockId) : null,
      title: parseTitle(body.title),
      // Tasks are blocks of the job's note; without one there is nowhere to
      // find them.
      taskIds: docId ? parseTaskIds(body.taskIds) : [],
      skills: Array.isArray(body.skills) ? body.skills.map(String) : null,
      createdBy: userId,
      runAfter,
      maxCostUsd: parseUsd(body.maxCostUsd),
      access,
    });
    // Full access is "Allow all" from the start.
    if (access === 'full') {
      await this.models.registryJob.allowAllTools(job.id, userId);
      job.allowAllTools = true;
    }

    this.logger.log(
      `queued job ${job.id} for ${workspaceId}/${deviceKey}` +
        (runAfter ? ` (held until ${runAfter.toISOString()})` : '')
    );
    await this.tasks?.queued(job);
    return toJobDto(job);
  }

  async get(
    workspaceId: string,
    id: string,
    logFrom?: number
  ): Promise<JobDto | null> {
    let job = await this.models.registryJob.get(workspaceId, id);
    if (!job) return null;
    job = await this.noteLostRunner(job);
    job = await this.noteUnclaimed(job);
    // Questions travel with the transcript: both are what a viewer of one
    // run needs, and neither belongs in a listing.
    const questions =
      logFrom === undefined
        ? undefined
        : await this.models.registryJob.listQuestions(id);
    return toJobDto(job, { logFrom, questions });
  }

  /**
   * A running job whose runner stopped renewing its lease would otherwise
   * sit silent until a runner claims it again — possibly never, with nothing
   * in its log to say why. Write that into the log when someone looks.
   */
  private async noteLostRunner(job: RegistryJob): Promise<RegistryJob> {
    const lease = job.leaseExpiresAt;
    if (
      job.status !== 'running' ||
      !lease ||
      lease.getTime() + LEASE_LAPSE_GRACE_MS > Date.now()
    ) {
      return job;
    }
    const { marker, note } = leaseLapsedNote(job, lease);
    // Its own line, even when the last report ended mid-line.
    const text = `${job.log && !job.log.endsWith('\n') ? '\n' : ''}${note}\n`;
    const written = await this.models.registryJob.noteLeaseLapsed(
      job.id,
      lease,
      marker,
      text
    );
    if (!written) return job;
    this.logger.warn(
      `job ${job.id} on ${job.workspaceId}/${job.deviceKey}: runner ` +
        `${job.claimedBy ?? '?'} lost (lease ran out ${lease.toISOString()})`
    );
    return (await this.models.registryJob.get(job.workspaceId, job.id)) ?? job;
  }

  /**
   * A queued run on a device whose runner isn't asking for work just waits,
   * with an empty log. Say so, and how to start one, when someone looks.
   * A run held back to a later time (a session limit) is waiting on purpose.
   */
  private async noteUnclaimed(job: RegistryJob): Promise<RegistryJob> {
    const now = Date.now();
    if (
      job.status !== 'queued' ||
      job.createdAt.getTime() + UNCLAIMED_AFTER_MS > now ||
      (job.runAfter && job.runAfter.getTime() > now)
    ) {
      return job;
    }
    const device = await this.models.registryDevice.get(job.workspaceId, job.deviceKey);
    // No device row: the server's own cloud runner, which isn't polled for.
    if (!device) return job;
    const seen = device.runnerSeenAt;
    if (seen && seen.getTime() + RUNNER_QUIET_MS > now) return job;
    const { marker, note } = unclaimedNote(job, device.host, seen);
    const text = `${job.log && !job.log.endsWith('\n') ? '\n' : ''}${note}\n`;
    if (!(await this.models.registryJob.noteUnclaimed(job.id, marker, text))) {
      return job;
    }
    return (await this.models.registryJob.get(job.workspaceId, job.id)) ?? job;
  }

  async list(workspaceId: string, deviceKey?: string, status?: string): Promise<JobDto[]> {
    const jobs = await this.models.registryJob.list(workspaceId, { deviceKey, status });
    return jobs.map(job => toJobDto(job));
  }

  async claim(
    workspaceId: string,
    deviceKey: string,
    runnerId: string,
    leaseSeconds?: number
  ): Promise<JobDto | null> {
    // Asking is what "a runner is listening" means, whether or not there is
    // work to hand out. Best effort: never fail a claim over it.
    try {
      await this.models.registryDevice.touchRunner(workspaceId, deviceKey);
    } catch (err) {
      this.logger.warn(`touchRunner failed: ${err}`);
    }
    const job = await this.models.registryJob.claim(
      workspaceId, deviceKey, runnerId || 'runner', leaseSeconds
    );
    if (!job) return null;
    await this.tasks?.claimed(job);
    const profile = await this.profile(job);
    // What earlier runs learned about whoever started this one.
    return {
      ...toJobDto(job),
      profile: this.memory ? await this.memory.withRecall(job, profile) : profile,
    };
  }

  /**
   * How the runner is to run a claimed job: its model's profile, with the
   * skill notes it names (looked up in the job's own workspace only) and
   * the workspace's "Agent rules" note (see agent-rules.ts), both read
   * now, at the start of the run, so the user's latest edits are the ones
   * it follows.
   */
  private async profile(job: RegistryJob): Promise<AgentProfile | null> {
    const noteSkills =
      (await this.skillNotes?.forJob(job.workspaceId, job.skills, job.createdBy)) ?? [];
    const profile = profileFor(job.model, job.skills, job.access, noteSkills);
    if (!profile || !this.rules) return profile;
    return withAgentRules(
      profile,
      await this.rules.read(job.workspaceId, job.createdBy)
    );
  }

  async report(
    workspaceId: string,
    id: string,
    body: Record<string, unknown>
  ): Promise<JobDto | null> {
    const status = body.status ? String(body.status) : undefined;
    if (status && !['running', ...JOB_TERMINAL].includes(status)) {
      throw new BadRequest(
        `status must be one of running, ${JOB_TERMINAL.join(', ')}`
      );
    }
    const result = body.result === undefined ? undefined : String(body.result ?? '');
    const error = body.error === undefined ? undefined : String(body.error ?? '');
    const logAppend = body.logAppend ? String(body.logAppend) : undefined;

    // Claude stopped at the device's session limit: nothing was done, so the
    // job goes back in the queue until the limit resets, and so does
    // everything else waiting for that device, rather than failing in turn.
    // A "done" whose whole answer is the limit message counts too.
    const limit =
      status === 'error' ? error : status === 'done' && (result ?? '').length < 300 ? result : undefined;
    if (isSessionLimit(limit)) {
      const runAfter = sessionLimitRunAfter(limit!);
      const note =
        `⏸ Claude session limit reached (${limit!.trim()}). ` +
        `Queued to run again at ${runAfter.toISOString()}.\n`;
      const requeued = await this.models.registryJob.requeue(
        workspaceId,
        id,
        runAfter,
        (logAppend ?? '') + (logAppend && !logAppend.endsWith('\n') ? '\n' : '') + note
      );
      if (requeued?.status === 'queued') {
        const held = await this.models.registryJob.holdQueued(
          workspaceId, requeued.deviceKey, runAfter
        );
        this.logger.log(
          `job ${id} hit the session limit; ${held} job(s) on ` +
            `${requeued.deviceKey} held until ${runAfter.toISOString()}`
        );
      }
      return requeued ? toJobDto(requeued) : null;
    }

    const job = await this.models.registryJob.report(workspaceId, id, {
      status,
      result,
      error,
      steps: body.steps === undefined ? undefined : Number(body.steps),
      costUsd: body.costUsd == null || !Number.isFinite(Number(body.costUsd))
        ? undefined
        : Math.max(0, Number(body.costUsd)),
      tokens: body.tokens == null || !Number.isFinite(Number(body.tokens))
        ? undefined
        : Math.max(0, Math.round(Number(body.tokens))),
      logAppend,
      tmuxSession: body.tmuxSession ? String(body.tmuxSession).slice(0, 200) : undefined,
      leaseSeconds: body.leaseSeconds === undefined ? undefined : Number(body.leaseSeconds),
    });
    // Whoever queued the job may be waiting on its end (a monitor, say).
    if (job && (JOB_TERMINAL as readonly string[]).includes(job.status)) {
      const taskStatuses = (await this.tasks?.finished(job)) ?? {};
      // Only on the report that ended it: a cancelled job answers later
      // reports with itself, and the user cancelled it anyway.
      if (status === job.status) {
        this.notify(push => push.runFinished(job, taskStatuses));
      }
      this.event?.emit('registry.job.finished', {
        workspaceId,
        jobId: job.id,
        status: job.status,
        result: job.result,
        error: job.error,
      });
    }
    return job ? toJobDto(job) : null;
  }

  /** The agent names its run once it knows what it is doing. */
  async setTitle(
    workspaceId: string,
    id: string,
    body: Record<string, unknown>
  ): Promise<JobDto | null> {
    const title = parseTitle(body.title);
    if (!title) {
      throw new BadRequest('title is required');
    }
    const job = await this.models.registryJob.setTitle(workspaceId, id, title);
    return job ? toJobDto(job) : null;
  }

  private async runningJob(workspaceId: string, jobId: string) {
    const job = await this.models.registryJob.get(workspaceId, jobId);
    if (!job) {
      throw new NotFound(`No job '${jobId}' in this workspace`);
    }
    return job;
  }

  /** A runner asks the person who started the job something, and waits. */
  async ask(
    workspaceId: string,
    jobId: string,
    body: Record<string, unknown>
  ): Promise<QuestionDto> {
    const job = await this.runningJob(workspaceId, jobId);
    if (job.status !== 'running') {
      throw new BadRequest(`Job '${jobId}' is ${job.status}, not running`);
    }
    const kind = String(body.kind ?? 'question') as QuestionKind;
    if (!QUESTION_KINDS.includes(kind)) {
      throw new BadRequest(`kind must be one of ${QUESTION_KINDS.join(', ')}`);
    }
    const text = String(body.text ?? '').trim();
    if (!text) {
      throw new BadRequest('text is required');
    }
    const detail = body.detail ? String(body.detail).slice(0, MAX_DETAIL) : null;
    const ownTool = kind === 'permission' && ALWAYS_ALLOWED_PERMISSIONS.has(text);
    // A read-level agent is refused anything its tool list doesn't cover,
    // without asking anyone.
    const refused =
      kind === 'permission' && !ownTool && job.access === 'read'
        ? 'This agent can only read (its permission level is "read"); it may not use this tool.'
        : undefined;
    // After "Allow all" a permission is recorded as allowed by whoever
    // started the run, rather than waiting on them again, unless it deploys,
    // spends or deletes. So is one of the run's own tools.
    const allowAll =
      kind === 'permission' &&
      !refused &&
      (ownTool || (job.allowAllTools && !alwaysAsks(text, detail)));
    const question = await this.models.registryJob.ask(jobId, {
      kind,
      text: text.slice(0, MAX_QUESTION),
      detail,
      options: kind === 'question' ? parseOptions(body.options) : [],
      ...(allowAll ? { allowedBy: job.createdBy } : {}),
      ...(refused ? { refused } : {}),
    });
    this.logger.log(
      `job ${jobId} asked a ${kind}` +
        (allowAll ? ' (allowed: allow all)' : refused ? ' (refused: read only)' : '')
    );
    if (!allowAll && !refused) {
      this.notify(push => push.questionAsked(job, question));
    }
    return toQuestionDto(question);
  }

  /**
   * One question, plus the job's status: a runner waiting on an answer must
   * also notice that the job was cancelled underneath it.
   */
  async getQuestion(workspaceId: string, jobId: string, questionId: string) {
    const job = await this.runningJob(workspaceId, jobId);
    const question = await this.models.registryJob.getQuestion(jobId, questionId);
    if (!question) {
      throw new NotFound(`No question '${questionId}' on job '${jobId}'`);
    }
    return { question: toQuestionDto(question), jobStatus: job.status };
  }

  /**
   * Answer a question. Only the person who started the job may: a permission
   * answered here runs a tool on someone's machine, and a question's answer
   * is written into their notes.
   */
  async answer(
    workspaceId: string,
    jobId: string,
    questionId: string,
    userId: string,
    body: Record<string, unknown>
  ): Promise<QuestionDto> {
    const job = await this.runningJob(workspaceId, jobId);
    if (job.createdBy && job.createdBy !== userId) {
      throw new ActionForbidden('Only the person who started this run can answer it.');
    }
    const question = await this.models.registryJob.getQuestion(jobId, questionId);
    // A steer is taken by the runner; answering one would mark it delivered.
    if (!question || question.kind === STEER_KIND) {
      throw new NotFound(`No question '${questionId}' on job '${jobId}'`);
    }
    if (question.answeredAt) {
      throw new BadRequest('That question has already been answered.');
    }

    let input: { answer?: string; allowed?: boolean };
    const allowAll = body.allowAll === true;
    if (question.kind === 'permission') {
      if (typeof body.allowed !== 'boolean') {
        throw new BadRequest('allowed (true or false) is required for a permission');
      }
      if (allowAll && !body.allowed) {
        throw new BadRequest('allowAll only goes with allowed: true');
      }
      input = {
        allowed: body.allowed,
        answer: body.answer ? String(body.answer).slice(0, MAX_ANSWER) : undefined,
      };
    } else {
      const answer = String(body.answer ?? '').trim();
      if (!answer) {
        throw new BadRequest('answer is required');
      }
      input = { answer: answer.slice(0, MAX_ANSWER) };
    }

    const answered = await this.models.registryJob.answer(
      jobId, questionId, input, userId
    );
    if (!answered) {
      throw new BadRequest('That question has already been answered.');
    }
    const closed = [questionId];
    if (allowAll && question.kind === 'permission') {
      // The permissions still open beside this one are allowed with it, so
      // their notifications go too; those that deploy, spend or delete stay.
      const { allowed, kept } = await this.openPermissions(jobId, questionId);
      closed.push(...allowed);
      await this.models.registryJob.allowAllTools(jobId, userId, kept);
      this.logger.log(`job ${jobId}: allow all tools`);
    }
    this.notify(push => push.questionsClosed(job, closed));
    return toQuestionDto(answered);
  }

  /**
   * Send a running job a new instruction. Its runner picks it up after the
   * agent's next tool call, so the run changes course without restarting.
   * Only the job's starter may, as with answering it. A queued job keeps it
   * for its first step.
   */
  async steer(
    workspaceId: string,
    jobId: string,
    userId: string,
    body: Record<string, unknown>
  ): Promise<SteerDto> {
    const job = await this.runningJob(workspaceId, jobId);
    if (job.createdBy && job.createdBy !== userId) {
      throw new ActionForbidden('Only the person who started this run can message it.');
    }
    if ((JOB_TERMINAL as readonly string[]).includes(job.status)) {
      throw new BadRequest(`Job '${jobId}' is ${job.status}; it can't take a message now.`);
    }
    const text = String(body.text ?? '').trim();
    if (!text) {
      throw new BadRequest('text is required');
    }
    if (text.length > MAX_ANSWER) {
      throw new BadRequest(`The message exceeds ${MAX_ANSWER} characters.`);
    }
    const steer = await this.models.registryJob.steer(jobId, text);
    this.logger.log(`job ${jobId}: message queued`);
    return toSteerDto(steer);
  }

  /**
   * The runner takes the messages waiting for its job, each once. Empty for
   * a job that is no longer running: an ended run has no next step.
   */
  async takeSteers(workspaceId: string, jobId: string) {
    const job = await this.runningJob(workspaceId, jobId);
    if (job.status !== 'running') {
      return { steers: [], jobStatus: job.status };
    }
    const steers = await this.models.registryJob.takeSteers(jobId);
    if (steers.length) {
      this.logger.log(`job ${jobId}: delivered ${steers.length} message(s)`);
    }
    return {
      steers: steers.map(steer => ({
        id: steer.id,
        text: steer.text,
        createdAt: steer.createdAt.getTime() / 1000,
      })),
      jobStatus: job.status,
    };
  }

  /**
   * "Allow all" up front, before the run has asked anything: from the moment
   * it is queued, every permission it asks is allowed. Only the job's starter
   * may, as with answering one.
   */
  async allowAll(
    workspaceId: string,
    jobId: string,
    userId: string
  ): Promise<JobDto> {
    const job = await this.runningJob(workspaceId, jobId);
    if (job.createdBy && job.createdBy !== userId) {
      throw new ActionForbidden('Only the person who started this run can allow its tools.');
    }
    if ((JOB_TERMINAL as readonly string[]).includes(job.status)) {
      throw new BadRequest(`Job '${jobId}' is ${job.status}; there is nothing left to allow.`);
    }
    // Any permission already waiting is allowed with it, so its notification
    // goes, unless it deploys, spends or deletes.
    const { allowed: open, kept } = await this.openPermissions(jobId);
    await this.models.registryJob.allowAllTools(jobId, userId, kept);
    this.logger.log(`job ${jobId}: allow all tools (up front)`);
    if (open.length) {
      this.notify(push => push.questionsClosed(job, open));
    }
    return toJobDto({ ...job, allowAllTools: true });
  }

  /** A job's open permissions, split by whether "Allow all" covers them. */
  private async openPermissions(jobId: string, except?: string) {
    const open = (await this.models.registryJob.listQuestions(jobId)).filter(
      q => q.kind === 'permission' && !q.answeredAt && q.id !== except
    );
    return {
      allowed: open.filter(q => !alwaysAsks(q.text, q.detail)).map(q => q.id),
      kept: open.filter(q => alwaysAsks(q.text, q.detail)).map(q => q.id),
    };
  }

  /** Refuse a new run once this month's runs have used the budget. */
  private async checkBudget(workspaceId: string) {
    const { monthlyUsd, spentUsd, month } = await this.budget(workspaceId);
    if (monthlyUsd !== null && spentUsd >= monthlyUsd) {
      throw new BadRequest(
        `This workspace's agent runs have used their $${monthlyUsd.toFixed(2)} ` +
          `budget for ${month} ($${spentUsd.toFixed(2)} spent). Raise the budget ` +
          'on the Agents page, or wait for next month.'
      );
    }
  }

  async budget(workspaceId: string): Promise<AgentBudgetDto> {
    const since = monthStart();
    const [monthlyUsd, spentUsd] = await Promise.all([
      this.models.registryJob.getBudget(workspaceId),
      this.models.registryJob.spentSince(workspaceId, since),
    ]);
    return {
      monthlyUsd,
      spentUsd: Math.round(spentUsd * 10_000) / 10_000,
      month: since.toISOString().slice(0, 7),
    };
  }

  async setBudget(
    workspaceId: string,
    userId: string,
    body: Record<string, unknown>
  ): Promise<AgentBudgetDto> {
    const monthlyUsd = body.monthlyUsd === null ? null : parseUsd(body.monthlyUsd);
    if (body.monthlyUsd !== null && monthlyUsd === null) {
      throw new BadRequest('monthlyUsd must be a positive number of dollars, or null for no budget');
    }
    await this.models.registryJob.setBudget(workspaceId, monthlyUsd, userId);
    return this.budget(workspaceId);
  }

  async cancel(workspaceId: string, id: string): Promise<JobDto | null> {
    const job = await this.models.registryJob.cancel(workspaceId, id);
    if (job?.status === 'cancelled') await this.tasks?.finished(job);
    return job ? toJobDto(job) : null;
  }
}

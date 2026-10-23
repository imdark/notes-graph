import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  Prisma,
  type RegistryJob,
  type RegistryJobQuestion,
} from '@prisma/client';

import { BaseModel } from './base';

/** Terminal states: a job in one of these is never handed out again. */
export const JOB_TERMINAL = ['done', 'error', 'cancelled'] as const;
export const JOB_STATUSES = ['queued', 'running', ...JOB_TERMINAL] as const;
export const QUESTION_KINDS = ['question', 'permission'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
/**
 * A message the person sent a running job, kept with its questions: `text`
 * is the instruction and `answeredAt` is when the runner took it.
 */
export const STEER_KIND = 'steer';

export interface CreateRegistryJobInput {
  workspaceId: string;
  deviceKey: string;
  agentId: string;
  agentName: string;
  instructions: string;
  context: string;
  model?: string | null;
  tools?: Prisma.InputJsonValue;
  maxSteps?: number;
  targetKind?: string | null;
  docId?: string | null;
  blockId?: string | null;
  title?: string | null;
  taskIds?: string[];
  /** Skill names the agent chose; null for the model's default set. */
  skills?: string[] | null;
  createdBy?: string | null;
  runAfter?: Date | null;
  maxCostUsd?: number | null;
  access?: string | null;
  /** 'agent' unless given; see `JOB_KINDS`. */
  kind?: JobKind;
  payload?: Prisma.InputJsonValue | null;
}

/**
 * What a job carries: an agent run, or an automation's code. A runner claims
 * only the kinds it names, and one that names none gets agent jobs, so a
 * runner from before automations never receives code it can't run.
 */
export const JOB_KINDS = ['agent', 'automation'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** The kinds a runner's claim asks for: known names only, agent by default. */
export function parseJobKinds(raw: unknown): JobKind[] {
  const kinds = Array.isArray(raw)
    ? JOB_KINDS.filter(kind => raw.includes(kind))
    : [];
  return kinds.length ? kinds : ['agent'];
}

/**
 * Most transcript text kept per job. Past this the head is dropped: while a
 * run is going, the end is what someone watching needs, and the result field
 * already holds the answer.
 */
export const JOB_LOG_CAP = 200_000;

/**
 * Every transcript line starts with the time the server received it, as
 * `[<ISO time>] `. The device sends plain text; stamping here gives every
 * run's log the same timeline whichever device wrote it. The log viewer in
 * the app parses this exact prefix (modules/agents/services/log-lines.ts).
 */
export const logStamp = (at: Date) => `[${at.toISOString()}] `;

/**
 * Stamp the line starts *inside* an appended chunk. Whether the chunk's first
 * character starts a line depends on the stored log, so that one is decided
 * in SQL where the row is read.
 */
export const stampInnerLines = (text: string, stamp: string) =>
  text.replace(/\n(?=[^\n])/g, `\n${stamp}`);

export interface ReportRegistryJobInput {
  status?: string;
  result?: string | null;
  error?: string | null;
  steps?: number;
  costUsd?: number;
  tokens?: number;
  /** Transcript text produced since the last report, appended to `log`. */
  logAppend?: string;
  tmuxSession?: string | null;
  /** Extends the lease while a long run is still making progress. */
  leaseSeconds?: number;
  /** What the run changed; kept only with the report that ends it. */
  changes?: Prisma.InputJsonValue;
}

/**
 * A job that can be handed to a runner: queued and not held back to a later
 * time, or running on a lease that has lapsed.
 */
const claimable = (now: Date): Prisma.RegistryJobWhereInput[] => [
  { status: 'queued', OR: [{ runAfter: null }, { runAfter: { lte: now } }] },
  { status: 'running', leaseExpiresAt: { lt: now } },
];

@Injectable()
export class RegistryJobModel extends BaseModel {
  async create(input: CreateRegistryJobInput): Promise<RegistryJob> {
    return this.db.registryJob.create({
      data: {
        workspaceId: input.workspaceId,
        deviceKey: input.deviceKey,
        agentId: input.agentId,
        agentName: input.agentName,
        instructions: input.instructions,
        context: input.context,
        model: input.model ?? null,
        tools: input.tools ?? [],
        maxSteps: input.maxSteps ?? 8,
        targetKind: input.targetKind ?? null,
        docId: input.docId ?? null,
        blockId: input.blockId ?? null,
        title: input.title ?? null,
        taskIds: input.taskIds ?? [],
        skills: input.skills ?? Prisma.DbNull,
        createdBy: input.createdBy ?? null,
        runAfter: input.runAfter ?? null,
        maxCostUsd: input.maxCostUsd ?? null,
        access: input.access ?? null,
        kind: input.kind ?? 'agent',
        payload: input.payload ?? Prisma.DbNull,
      },
    });
  }

  async get(workspaceId: string, id: string): Promise<RegistryJob | null> {
    const job = await this.db.registryJob.findUnique({ where: { id } });
    // Scope by workspace here rather than trusting the id alone: a uuid from
    // another workspace must read as absent, not as someone else's job.
    return job && job.workspaceId === workspaceId ? job : null;
  }

  async list(
    workspaceId: string,
    filter: { deviceKey?: string; status?: string; limit?: number } = {}
  ): Promise<RegistryJob[]> {
    return this.db.registryJob.findMany({
      where: {
        workspaceId,
        ...(filter.deviceKey ? { deviceKey: filter.deviceKey } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filter.limit ?? 50,
    });
  }

  /**
   * Hand the oldest queued job for a device to one runner.
   *
   * The update is conditional on the row still being claimable, so two
   * runners racing on the same device cannot both win: the loser's
   * updateMany matches nothing and it retries. A job whose lease has expired
   * is claimable again, which is what recovers work from a runner that died
   * mid-run.
   */
  async claim(
    workspaceId: string,
    deviceKey: string,
    runnerId: string,
    leaseSeconds = 300,
    kinds: readonly JobKind[] = ['agent']
  ): Promise<RegistryJob | null> {
    const now = new Date();
    const candidate = await this.db.registryJob.findFirst({
      where: {
        workspaceId,
        deviceKey,
        kind: { in: [...kinds] },
        OR: claimable(now),
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) {
      return null;
    }

    const lease = new Date(now.getTime() + leaseSeconds * 1000);
    const { count } = await this.db.registryJob.updateMany({
      where: {
        id: candidate.id,
        // Re-assert the claimable condition; if another runner took it
        // between the read and this write, count comes back 0.
        OR: claimable(now),
      },
      data: {
        status: 'running',
        claimedBy: runnerId,
        leaseExpiresAt: lease,
        startedAt: candidate.startedAt ?? now,
      },
    });
    if (count === 0) {
      return null;
    }
    return this.db.registryJob.findUnique({ where: { id: candidate.id } });
  }

  /**
   * Jobs on a device a runner holds: running on a live lease. A lapsed lease
   * is no longer held; the job is claimable again (see `claimable`).
   */
  async countHeld(workspaceId: string, deviceKey: string): Promise<number> {
    return this.db.registryJob.count({
      where: {
        workspaceId,
        deviceKey,
        status: 'running',
        leaseExpiresAt: { gte: new Date() },
      },
    });
  }

  async report(
    workspaceId: string,
    id: string,
    input: ReportRegistryJobInput
  ): Promise<RegistryJob | null> {
    const job = await this.get(workspaceId, id);
    if (!job) {
      return null;
    }
    // A cancelled job stays cancelled: the user's decision outranks a report
    // from a runner that had not noticed yet.
    if (job.status === 'cancelled') {
      return job;
    }

    if (input.logAppend) {
      await this.appendLog(id, input.logAppend);
    }

    const status = input.status ?? job.status;
    const terminal = (JOB_TERMINAL as readonly string[]).includes(status);
    return this.db.registryJob.update({
      where: { id },
      data: {
        status,
        result: input.result ?? job.result,
        error: input.error ?? job.error,
        steps: input.steps ?? job.steps,
        costUsd: input.costUsd ?? job.costUsd,
        tokens: input.tokens ?? job.tokens,
        tmuxSession: input.tmuxSession ?? job.tmuxSession,
        ...(terminal && input.changes !== undefined
          ? { changes: input.changes }
          : {}),
        finishedAt: terminal ? new Date() : null,
        leaseExpiresAt: terminal
          ? null
          : new Date(Date.now() + (input.leaseSeconds ?? 300) * 1000),
      },
    });
  }

  /**
   * Put a job that ended without doing its work back in the queue, not to be
   * handed out before `runAfter`. A cancelled job stays cancelled.
   */
  async requeue(
    workspaceId: string,
    id: string,
    runAfter: Date,
    logAppend?: string
  ): Promise<RegistryJob | null> {
    const job = await this.get(workspaceId, id);
    if (!job || job.status === 'cancelled') {
      return job;
    }
    if (logAppend) {
      await this.appendLog(id, logAppend);
    }
    return this.db.registryJob.update({
      where: { id },
      data: {
        status: 'queued',
        runAfter,
        error: null,
        claimedBy: null,
        leaseExpiresAt: null,
        tmuxSession: null,
        finishedAt: null,
      },
    });
  }

  /** Hold every job still queued for a device until at least `runAfter`. */
  async holdQueued(
    workspaceId: string,
    deviceKey: string,
    runAfter: Date
  ): Promise<number> {
    const { count } = await this.db.registryJob.updateMany({
      where: {
        workspaceId,
        deviceKey,
        status: 'queued',
        OR: [{ runAfter: null }, { runAfter: { lt: runAfter } }],
      },
      data: { runAfter },
    });
    return count;
  }

  /** The latest time a device's queued jobs are held to, if still ahead. */
  async heldUntil(
    workspaceId: string,
    deviceKey: string
  ): Promise<Date | null> {
    const held = await this.db.registryJob.findFirst({
      where: {
        workspaceId,
        deviceKey,
        status: 'queued',
        runAfter: { gt: new Date() },
      },
      orderBy: { runAfter: 'desc' },
      select: { runAfter: true },
    });
    return held?.runAfter ?? null;
  }

  /**
   * Rename a job. Separate from `report`, which renews the lease: the agent
   * names its run from inside the job, not as the runner, and must not
   * shorten the lease the runner holds.
   */
  async setTitle(
    workspaceId: string,
    id: string,
    title: string
  ): Promise<RegistryJob | null> {
    const job = await this.get(workspaceId, id);
    if (!job) {
      return null;
    }
    return this.db.registryJob.update({ where: { id }, data: { title } });
  }

  /** Record tasks the claim moved to in progress, beside any it moved before. */
  async addStartedTasks(id: string, taskIds: string[]): Promise<void> {
    if (!taskIds.length) return;
    await this.db.registryJob.update({
      where: { id },
      data: { startedTaskIds: { push: taskIds } },
    });
  }

  /**
   * Of `taskIds` in a doc, those another job still queued or running is on,
   * so a job that ends doesn't hand back tasks a newer run has claimed.
   */
  async tasksClaimedElsewhere(
    workspaceId: string,
    docId: string,
    exceptJobId: string,
    taskIds: string[]
  ): Promise<string[]> {
    if (!taskIds.length) return [];
    const others = await this.db.registryJob.findMany({
      where: {
        workspaceId,
        docId,
        id: { not: exceptJobId },
        status: { in: ['queued', 'running'] },
        taskIds: { hasSome: taskIds },
      },
      select: { taskIds: true },
    });
    const claimed = new Set(others.flatMap(job => job.taskIds));
    return taskIds.filter(id => claimed.has(id));
  }

  /**
   * Append to a job's transcript in one statement, keeping only the last
   * JOB_LOG_CAP characters. Done in SQL rather than read-modify-write so a
   * heartbeat landing alongside a log report cannot lose text; every SET
   * expression sees the pre-update row, so `log_dropped` and `log` agree.
   */
  private async appendLog(
    id: string,
    raw: string,
    /** Extra WHERE condition; the append is skipped when it doesn't hold. */
    guard: Prisma.Sql = Prisma.empty,
    /**
     * Start the chunk on a line of its own, breaking the runner's current
     * line if it is mid-way through one. For text the server writes itself.
     */
    ownLine = false
  ): Promise<number> {
    const stamp = logStamp(new Date());
    const text = stampInnerLines(raw, stamp);
    // The chunk's first character starts a line when the log is empty or
    // ended on a newline; only then does it get a stamp of its own.
    // Decided inside SET, which sees the row as locked for this update, so a
    // concurrent append cannot make the decision stale.
    const lead = Prisma.sql`CASE
      WHEN "log" = '' OR RIGHT("log", 1) = E'\n' THEN ${stamp}::text
      ELSE ${ownLine ? `\n${stamp}` : ''}::text
    END`;
    return this.db.$executeRaw`
      UPDATE "registry_jobs"
      SET "log" = RIGHT("log" || ${lead} || ${text}::text, ${JOB_LOG_CAP}::int),
          "log_dropped" = "log_dropped"
            + GREATEST(0, LENGTH("log") + LENGTH(${lead} || ${text}::text) - ${JOB_LOG_CAP}::int)
      WHERE "id" = ${id} ${guard}`;
  }

  /**
   * Say in a running job's transcript that its runner has gone quiet: the
   * lease it renews with every report ran out. Written once per lapse — only
   * while the row still holds that same lease and the transcript doesn't
   * already carry `marker` — so every viewer polling the job can call this.
   * Returns whether the note was written.
   */
  async noteLeaseLapsed(
    id: string,
    leaseExpiresAt: Date,
    marker: string,
    note: string
  ): Promise<boolean> {
    const written = await this.appendLog(
      id,
      note,
      Prisma.sql`AND "status" = 'running'
        AND "lease_expires_at" = ${leaseExpiresAt}
        AND POSITION(${marker}::text IN "log") = 0`
    );
    return written > 0;
  }

  /**
   * Say in a queued job's transcript that nothing on its device is picking
   * work up. Once per job (the transcript must not already carry `marker`),
   * and only while it is still queued.
   */
  async noteUnclaimed(
    id: string,
    marker: string,
    note: string
  ): Promise<boolean> {
    const written = await this.appendLog(
      id,
      note,
      Prisma.sql`AND "status" = 'queued'
        AND POSITION(${marker}::text IN "log") = 0`
    );
    return written > 0;
  }

  /**
   * Record a question from a running job. The runner then polls for it.
   * `allowedBy` records a permission as already allowed on that person's
   * behalf (the run has "Allow all"), so the runner's first poll finds it
   * answered and the run's questions still show what it did.
   */
  async ask(
    jobId: string,
    input: {
      kind: QuestionKind;
      text: string;
      detail?: string | null;
      options?: string[];
      allowedBy?: string | null;
      /** Refused on the spot, with this as the answer the runner sees. */
      refused?: string;
    }
  ): Promise<RegistryJobQuestion> {
    const allowed = input.allowedBy !== undefined;
    return this.db.registryJobQuestion.create({
      data: {
        jobId,
        kind: input.kind,
        text: input.text,
        detail: input.detail ?? null,
        options: input.options ?? [],
        ...(allowed
          ? {
              allowed: true,
              answeredBy: input.allowedBy,
              answeredAt: new Date(),
            }
          : {}),
        ...(input.refused !== undefined
          ? { allowed: false, answer: input.refused, answeredAt: new Date() }
          : {}),
      },
    });
  }

  /**
   * "Allow all": every later permission in this run is allowed without
   * asking, and any still open alongside the one answered are allowed now.
   */
  @Transactional()
  async allowAllTools(
    jobId: string,
    userId: string,
    /** Open permissions "Allow all" doesn't cover; they stay open. */
    except: string[] = []
  ): Promise<void> {
    await this.db.registryJob.update({
      where: { id: jobId },
      data: { allowAllTools: true },
    });
    await this.db.registryJobQuestion.updateMany({
      where: {
        jobId,
        kind: 'permission',
        answeredAt: null,
        id: { notIn: except },
      },
      data: { allowed: true, answeredBy: userId, answeredAt: new Date() },
    });
  }

  async getQuestion(
    jobId: string,
    questionId: string
  ): Promise<RegistryJobQuestion | null> {
    const question = await this.db.registryJobQuestion.findUnique({
      where: { id: questionId },
    });
    // Same scoping as `get`: a question id under the wrong job is absent.
    return question && question.jobId === jobId ? question : null;
  }

  async listQuestions(jobId: string): Promise<RegistryJobQuestion[]> {
    return this.db.registryJobQuestion.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Answer a question once. Conditional on it still being open, so two tabs
   * answering at the same moment cannot both win and hand the runner one
   * answer while the other person sees theirs as accepted.
   */
  async answer(
    jobId: string,
    questionId: string,
    input: { answer?: string | null; allowed?: boolean | null },
    userId: string
  ): Promise<RegistryJobQuestion | null> {
    const { count } = await this.db.registryJobQuestion.updateMany({
      where: { id: questionId, jobId, answeredAt: null },
      data: {
        answer: input.answer ?? null,
        allowed: input.allowed ?? null,
        answeredBy: userId,
        answeredAt: new Date(),
      },
    });
    if (count === 0) {
      return null;
    }
    return this.db.registryJobQuestion.findUnique({
      where: { id: questionId },
    });
  }

  /** Queue a message for a running job; its runner takes it on its next step. */
  async steer(jobId: string, text: string): Promise<RegistryJobQuestion> {
    return this.db.registryJobQuestion.create({
      data: { jobId, kind: STEER_KIND, text },
    });
  }

  /**
   * Hand a job's waiting messages to its runner, marking them taken in the
   * same statement so two hooks firing at once cannot both deliver one.
   * Each taken message is written into the transcript as its own line.
   */
  async takeSteers(
    jobId: string
  ): Promise<{ id: string; text: string; createdAt: Date }[]> {
    const taken = await this.db.$queryRaw<
      { id: string; text: string; created_at: Date }[]
    >`
      UPDATE "registry_job_questions"
      SET "answered_at" = NOW()
      WHERE "job_id" = ${jobId} AND "kind" = ${STEER_KIND}
        AND "answered_at" IS NULL
      RETURNING "id", "text", "created_at"`;
    const steers = taken
      .map(row => ({ id: row.id, text: row.text, createdAt: row.created_at }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (steers.length) {
      const lines = steers
        .map(steer => `✉ You sent: ${steer.text.replace(/\s*\n\s*/g, ' ')}\n`)
        .join('');
      await this.appendLog(jobId, lines, Prisma.empty, true);
    }
    return steers;
  }

  async cancel(workspaceId: string, id: string): Promise<RegistryJob | null> {
    const job = await this.get(workspaceId, id);
    if (!job) {
      return null;
    }
    if ((JOB_TERMINAL as readonly string[]).includes(job.status)) {
      return job; // already finished; nothing to cancel
    }
    return this.db.registryJob.update({
      where: { id },
      data: {
        status: 'cancelled',
        finishedAt: new Date(),
        leaseExpiresAt: null,
      },
    });
  }

  /** What the workspace's runs created since `since` have cost (USD). */
  async spentSince(workspaceId: string, since: Date): Promise<number> {
    const { _sum } = await this.db.registryJob.aggregate({
      where: { workspaceId, createdAt: { gte: since } },
      _sum: { costUsd: true },
    });
    return _sum.costUsd ?? 0;
  }

  /** Runs created since `since` that have ended, newest first, for spend reports. */
  async endedSince(workspaceId: string, since: Date, limit: number) {
    return this.db.registryJob.findMany({
      where: {
        workspaceId,
        createdAt: { gte: since },
        finishedAt: { not: null },
      },
      select: {
        docId: true,
        status: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        costUsd: true,
        tokens: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getBudget(workspaceId: string): Promise<number | null> {
    const row = await this.db.registryAgentBudget.findUnique({
      where: { workspaceId },
    });
    return row?.monthlyUsd ?? null;
  }

  /** Set the monthly budget, or remove it with null. */
  async setBudget(
    workspaceId: string,
    monthlyUsd: number | null,
    userId: string
  ): Promise<void> {
    if (monthlyUsd === null) {
      await this.db.registryAgentBudget.deleteMany({ where: { workspaceId } });
      return;
    }
    await this.db.registryAgentBudget.upsert({
      where: { workspaceId },
      create: { workspaceId, monthlyUsd, updatedBy: userId },
      update: { monthlyUsd, updatedBy: userId },
    });
  }
}

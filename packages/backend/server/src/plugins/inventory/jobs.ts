import { Injectable, Logger, Optional } from '@nestjs/common';
import type { InventoryJob, InventoryJobQuestion } from '@prisma/client';

// See the note in service.ts: a plain HttpException is reported as a 500 by
// the global filter, so bad input has to be a UserFriendlyError.
import { ActionForbidden, BadRequest, NotFound } from '../../base';
import { Models } from '../../models';
import {
  JOB_TERMINAL,
  QUESTION_KINDS,
  type QuestionKind,
} from '../../models/inventory-job';
import { AgentPushService } from './push';

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
  status: string;
  result: string | null;
  error: string | null;
  steps: number;
  /** Device-side tmux session the run is in, for `tmux attach -t`. */
  tmuxSession: string | null;
  claimedBy: string | null;
  /**
   * Transcript text from absolute offset `logFrom` to `logEnd`. Omitted from
   * listings, which would otherwise ship every job's transcript at once.
   */
  log?: string;
  logFrom?: number;
  logEnd?: number;
  /** Everything the run has asked, open ones last. Single-job reads only. */
  questions?: QuestionDto[];
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

export function toQuestionDto(question: InventoryJobQuestion): QuestionDto {
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

export interface JobDtoOptions {
  /** Include the transcript, starting at this absolute offset (0 = all kept). */
  logFrom?: number;
  questions?: InventoryJobQuestion[];
}

export function toJobDto(job: InventoryJob, options: JobDtoOptions = {}): JobDto {
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
    status: job.status,
    result: job.result,
    error: job.error,
    steps: job.steps,
    tmuxSession: job.tmuxSession,
    claimedBy: job.claimedBy,
    ...(options.logFrom === undefined ? {} : sliceLog(job, options.logFrom)),
    ...(options.questions ? { questions: options.questions.map(toQuestionDto) } : {}),
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
function sliceLog(job: InventoryJob, from: number) {
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
export class InventoryJobService {
  private readonly logger = new Logger(InventoryJobService.name);

  constructor(
    private readonly models: Models,
    @Optional() private readonly push?: AgentPushService
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
    const device = await this.models.inventoryDevice.get(workspaceId, deviceKey);
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

    const job = await this.models.inventoryJob.create({
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
      docId: body.docId ? String(body.docId) : null,
      blockId: body.blockId ? String(body.blockId) : null,
      title: parseTitle(body.title),
      createdBy: userId,
    });

    this.logger.log(`queued job ${job.id} for ${workspaceId}/${deviceKey}`);
    return toJobDto(job);
  }

  async get(
    workspaceId: string,
    id: string,
    logFrom?: number
  ): Promise<JobDto | null> {
    const job = await this.models.inventoryJob.get(workspaceId, id);
    if (!job) return null;
    // Questions travel with the transcript: both are what a viewer of one
    // run needs, and neither belongs in a listing.
    const questions =
      logFrom === undefined
        ? undefined
        : await this.models.inventoryJob.listQuestions(id);
    return toJobDto(job, { logFrom, questions });
  }

  async list(workspaceId: string, deviceKey?: string, status?: string): Promise<JobDto[]> {
    const jobs = await this.models.inventoryJob.list(workspaceId, { deviceKey, status });
    return jobs.map(job => toJobDto(job));
  }

  async claim(
    workspaceId: string,
    deviceKey: string,
    runnerId: string,
    leaseSeconds?: number
  ): Promise<JobDto | null> {
    const job = await this.models.inventoryJob.claim(
      workspaceId, deviceKey, runnerId || 'runner', leaseSeconds
    );
    return job ? toJobDto(job) : null;
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
    const job = await this.models.inventoryJob.report(workspaceId, id, {
      status,
      result: body.result === undefined ? undefined : String(body.result ?? ''),
      error: body.error === undefined ? undefined : String(body.error ?? ''),
      steps: body.steps === undefined ? undefined : Number(body.steps),
      logAppend: body.logAppend ? String(body.logAppend) : undefined,
      tmuxSession: body.tmuxSession ? String(body.tmuxSession).slice(0, 200) : undefined,
      leaseSeconds: body.leaseSeconds === undefined ? undefined : Number(body.leaseSeconds),
    });
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
    const job = await this.models.inventoryJob.setTitle(workspaceId, id, title);
    return job ? toJobDto(job) : null;
  }

  private async runningJob(workspaceId: string, jobId: string) {
    const job = await this.models.inventoryJob.get(workspaceId, jobId);
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
    // After "Allow all" a permission is recorded as allowed by whoever
    // started the run, rather than waiting on them again.
    const allowAll = kind === 'permission' && job.allowAllTools;
    const question = await this.models.inventoryJob.ask(jobId, {
      kind,
      text: text.slice(0, MAX_QUESTION),
      detail: body.detail ? String(body.detail).slice(0, MAX_DETAIL) : null,
      options: kind === 'question' ? parseOptions(body.options) : [],
      ...(allowAll ? { allowedBy: job.createdBy } : {}),
    });
    this.logger.log(
      `job ${jobId} asked a ${kind}${allowAll ? ' (allowed: allow all)' : ''}`
    );
    if (!allowAll) {
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
    const question = await this.models.inventoryJob.getQuestion(jobId, questionId);
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
    const question = await this.models.inventoryJob.getQuestion(jobId, questionId);
    if (!question) {
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

    const answered = await this.models.inventoryJob.answer(
      jobId, questionId, input, userId
    );
    if (!answered) {
      throw new BadRequest('That question has already been answered.');
    }
    const closed = [questionId];
    if (allowAll && question.kind === 'permission') {
      // The permissions still open beside this one are allowed with it, so
      // their notifications go too.
      if (this.push) {
        const open = await this.models.inventoryJob.listQuestions(jobId);
        closed.push(
          ...open
            .filter(q => q.kind === 'permission' && !q.answeredAt && q.id !== questionId)
            .map(q => q.id)
        );
      }
      await this.models.inventoryJob.allowAllTools(jobId, userId);
      this.logger.log(`job ${jobId}: allow all tools`);
    }
    this.notify(push => push.questionsClosed(job, closed));
    return toQuestionDto(answered);
  }

  async cancel(workspaceId: string, id: string): Promise<JobDto | null> {
    const job = await this.models.inventoryJob.cancel(workspaceId, id);
    return job ? toJobDto(job) : null;
  }
}

import {
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type { RegistryJobShare } from '@prisma/client';

import {
  ActionForbidden,
  Config,
  NotFound,
  Throttle,
  URLHelper,
} from '../../base';
import type { CurrentUser as CurrentUserType } from '../../core/auth';
import { CurrentUser, Public } from '../../core/auth';
import { PermissionAccess } from '../../core/permission';
import { Models } from '../../models';
import { redact } from './log-patterns';

/**
 * One question a shared run asked, without who answered or tool input. A
 * type rather than an interface so it is assignable to Prisma's JSON input.
 */
export type SharedQuestion = {
  kind: string;
  text: string;
  answer: string | null;
  allowed: boolean | null;
};

/** What a share link shows. Epoch seconds, like the job DTO. */
export interface SharedRunDto {
  title: string | null;
  status: string;
  log: string;
  result: string | null;
  error: string | null;
  questions: SharedQuestion[];
  sharedAt: number;
}

/** What the run's owner sees about its link. */
export interface RunShareDto {
  token: string;
  url: string;
  sharedAt: number;
}

export const sharedRunPath = (token: string) => `/share/run/${token}`;

const redactOrNull = (text: string | null) => (text === null ? null : redact(text));

/**
 * Public read-only snapshots of agent runs.
 *
 * The snapshot keeps only what a reader needs to follow the run: title,
 * status, transcript, result and the Q&A. The device, tmux session,
 * instructions, context and tool input stay behind, and every kept text
 * goes through the same redaction the monitoring agent applies to logs.
 */
@Injectable()
export class RegistryJobShareService {
  constructor(
    private readonly ac: PermissionAccess,
    private readonly models: Models,
    private readonly url: URLHelper
  ) {}

  private toShareDto(share: RegistryJobShare): RunShareDto {
    return {
      token: share.token,
      url: this.url.link(sharedRunPath(share.token)),
      sharedAt: share.updatedAt.getTime() / 1000,
    };
  }

  /** The job's starter, or someone who could dispatch it, may share it. */
  private async assertCanShare(userId: string, workspaceId: string, jobId: string) {
    await this.ac.user(userId).workspace(workspaceId).assert('Workspace.Read');
    const job = await this.models.registryJob.get(workspaceId, jobId);
    if (!job) throw new NotFound(`No job '${jobId}' in this workspace`);
    if (job.createdBy !== userId) {
      const canManage = await this.ac
        .user(userId)
        .workspace(workspaceId)
        .can('Workspace.Settings.Update');
      if (!canManage) {
        throw new ActionForbidden('Only the person who started this run can share it.');
      }
    }
    return job;
  }

  async get(userId: string, workspaceId: string, jobId: string) {
    await this.ac.user(userId).workspace(workspaceId).assert('Workspace.Read');
    const share = await this.models.registryJobShare.getByJob(workspaceId, jobId);
    return share ? this.toShareDto(share) : null;
  }

  async share(userId: string, workspaceId: string, jobId: string) {
    const job = await this.assertCanShare(userId, workspaceId, jobId);
    if (!(await this.models.workspace.allowSharing(workspaceId))) {
      throw new ActionForbidden('Sharing is turned off for this workspace.');
    }
    const questions = await this.models.registryJob.listQuestions(jobId);
    const share = await this.models.registryJobShare.upsert({
      workspaceId,
      jobId,
      title: redactOrNull(job.title),
      status: job.status,
      log: redact(job.log),
      result: redactOrNull(job.result),
      error: redactOrNull(job.error),
      questions: questions.map(
        (q): SharedQuestion => ({
          kind: q.kind,
          text: redact(q.text),
          answer: redactOrNull(q.answer),
          allowed: q.allowed,
        })
      ),
      createdBy: userId,
    });
    return this.toShareDto(share);
  }

  async revoke(userId: string, workspaceId: string, jobId: string) {
    await this.assertCanShare(userId, workspaceId, jobId);
    return (await this.models.registryJobShare.revoke(workspaceId, jobId)) > 0;
  }

  /** A link stops working when its workspace turns sharing off. */
  async read(token: string): Promise<SharedRunDto | null> {
    const share = await this.models.registryJobShare.getByToken(token);
    if (!share || !(await this.models.workspace.allowSharing(share.workspaceId))) {
      return null;
    }
    return {
      title: share.title,
      status: share.status,
      log: share.log,
      result: share.result,
      error: share.error,
      questions: (share.questions ?? []) as unknown as SharedQuestion[],
      sharedAt: share.updatedAt.getTime() / 1000,
    };
  }
}

/**
 * Its own controller rather than routes on RegistryController, so the one
 * public route sits apart from the PAT-authenticated registry API.
 */
@Controller(['/api/registry'])
export class RegistryJobShareController {
  constructor(
    private readonly shares: RegistryJobShareService,
    private readonly config: Config
  ) {}

  private assertEnabled() {
    if (!this.config.registry.enabled) {
      throw new NotFoundException('Registry API is not enabled on this server');
    }
  }

  @Get('/workspaces/:workspaceId/jobs/:jobId/share')
  async getShare(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('jobId') jobId: string
  ) {
    this.assertEnabled();
    return { share: await this.shares.get(user.id, workspaceId, jobId) };
  }

  /** Create the link, or refresh what it shows. The token stays the same. */
  @Post('/workspaces/:workspaceId/jobs/:jobId/share')
  async share(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('jobId') jobId: string
  ) {
    this.assertEnabled();
    return { share: await this.shares.share(user.id, workspaceId, jobId) };
  }

  @Delete('/workspaces/:workspaceId/jobs/:jobId/share')
  async revoke(
    @CurrentUser() user: CurrentUserType,
    @Param('workspaceId') workspaceId: string,
    @Param('jobId') jobId: string
  ) {
    this.assertEnabled();
    return { ok: await this.shares.revoke(user.id, workspaceId, jobId) };
  }

  /** Anyone with the link. Throttled: the token is the only credential. */
  @Public()
  @Throttle('default')
  @Get('/shared-runs/:token')
  async read(@Param('token') token: string) {
    this.assertEnabled();
    const run = await this.shares.read(token);
    if (!run) throw new NotFound('This link was turned off or never existed.');
    return { run };
  }
}

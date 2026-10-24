import { Injectable, Logger } from '@nestjs/common';
import type { RegistryJob } from '@prisma/client';

import { DocWriter } from '../../core/doc';
import { PermissionAccess } from '../../core/permission';
import { Models } from '../../models';
import {
  queueTasks,
  readStatuses,
  releaseTasks,
  setTaskStatuses,
  startTasks,
} from './task-status';

/**
 * The automation around a device job that is on tasks in a note: the tasks
 * are marked queued when the job is asked for, go to in progress when a
 * runner claims it, and are handed back to to-do when it ends — done, failed
 * or cancelled (a tab that times a run out cancels it) — unless the agent
 * moved them on, or another job has claimed them since.
 *
 * Here rather than in the tab that asked, so a run whose tab has closed, or
 * whose device failed it, doesn't leave its tasks stuck as queued. Nothing
 * here may fail the job it wraps: a task that can't be marked is logged.
 */
@Injectable()
export class JobTaskClaims {
  private readonly logger = new Logger(JobTaskClaims.name);

  constructor(
    private readonly models: Models,
    private readonly writer: DocWriter,
    private readonly ac: PermissionAccess
  ) {}

  async queued(job: RegistryJob): Promise<void> {
    await this.edit(job, 'queue', async (docId, ids) => {
      await this.writer.editDoc(
        job.workspaceId,
        docId,
        binary => queueTasks(binary, ids),
        job.createdBy ?? undefined
      );
    });
  }

  async claimed(job: RegistryJob): Promise<void> {
    await this.edit(job, 'start', async (docId, ids) => {
      const { changed } = await this.writer.editDoc(
        job.workspaceId,
        docId,
        binary => startTasks(binary, ids),
        job.createdBy ?? undefined
      );
      await this.models.registryJob.addStartedTasks(job.id, changed);
    });
  }

  /**
   * Hand back what the run left, and say where its tasks ended: the status
   * of each, by block id, as the agent left it (empty when it had none, or
   * they couldn't be read).
   */
  async finished(job: RegistryJob): Promise<Record<string, string>> {
    let statuses: Record<string, string> = {};
    await this.edit(job, 'release', async (docId, ids) => {
      const elsewhere = await this.models.registryJob.tasksClaimedElsewhere(
        job.workspaceId,
        docId,
        job.id,
        ids
      );
      const mine = ids.filter(id => !elsewhere.includes(id));
      if (!mine.length) return;
      await this.writer.editDoc(
        job.workspaceId,
        docId,
        binary => {
          statuses = readStatuses(binary, mine);
          return releaseTasks(binary, mine, job.startedTaskIds ?? []);
        },
        job.createdBy ?? undefined
      );
    });
    return statuses;
  }

  /**
   * Set the job's tasks to the statuses given, by block id (an automation's
   * end hook does this). Only the job's own tasks; others are ignored.
   * Returns the ids rewritten.
   */
  async set(
    job: RegistryJob,
    statuses: Record<string, string>
  ): Promise<string[]> {
    let changed: string[] = [];
    await this.edit(job, 'set', async (docId, ids) => {
      const mine = Object.fromEntries(
        Object.entries(statuses).filter(([id]) => ids.includes(id))
      );
      if (!Object.keys(mine).length) return;
      const edit = await this.writer.editDoc(
        job.workspaceId,
        docId,
        binary => setTaskStatuses(binary, mine),
        job.createdBy ?? undefined
      );
      changed = edit.changed;
    });
    return changed;
  }

  private async edit(
    job: RegistryJob,
    what: string,
    run: (docId: string, ids: string[]) => Promise<void>
  ): Promise<void> {
    const ids = job.taskIds ?? [];
    if (!job.docId || !ids.length || !job.createdBy) return;
    try {
      // The job writes its tasks as whoever asked for it, so only where
      // they may write.
      const allowed = await this.ac
        .user(job.createdBy)
        .workspace(job.workspaceId)
        .doc(job.docId)
        .can('Doc.Update');
      if (!allowed) return;
      await run(job.docId, ids);
    } catch (err) {
      this.logger.warn(
        `job ${job.id}: couldn't ${what} its tasks: ${(err as Error).message}`
      );
    }
  }
}

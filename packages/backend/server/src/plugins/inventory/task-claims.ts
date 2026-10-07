import { Injectable, Logger } from '@nestjs/common';
import type { InventoryJob } from '@prisma/client';

import { DocWriter } from '../../core/doc';
import { PermissionAccess } from '../../core/permission';
import { Models } from '../../models';
import { queueTasks, releaseTasks, startTasks } from './task-status';

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

  async queued(job: InventoryJob): Promise<void> {
    await this.edit(job, 'queue', async (docId, ids) => {
      await this.writer.editDoc(
        job.workspaceId,
        docId,
        binary => queueTasks(binary, ids),
        job.createdBy ?? undefined
      );
    });
  }

  async claimed(job: InventoryJob): Promise<void> {
    await this.edit(job, 'start', async (docId, ids) => {
      const { changed } = await this.writer.editDoc(
        job.workspaceId,
        docId,
        binary => startTasks(binary, ids),
        job.createdBy ?? undefined
      );
      await this.models.inventoryJob.addStartedTasks(job.id, changed);
    });
  }

  async finished(job: InventoryJob): Promise<void> {
    await this.edit(job, 'release', async (docId, ids) => {
      const elsewhere = await this.models.inventoryJob.tasksClaimedElsewhere(
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
        binary => releaseTasks(binary, mine, job.startedTaskIds ?? []),
        job.createdBy ?? undefined
      );
    });
  }

  private async edit(
    job: InventoryJob,
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

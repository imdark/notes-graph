import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';

import { JOB_SIGNAL, JobQueue, metrics, OnJob } from '../../base';
import { Models } from '../../models';
import {
  DatabaseDocReader,
  DocWriter,
  PgWorkspaceDocStorageAdapter,
} from '../doc';
import { enrichDoc } from './enrichment';

declare global {
  interface Jobs {
    'doc.mergePendingDocUpdates': {
      workspaceId: string;
      docId: string;
    };
    'doc.recordPendingDocUpdatesCount': {};
    'doc.findEmptySummaryDocs': {
      lastFixedWorkspaceSid?: number;
    };
    'doc.enrichUntitledDocs': {
      lastWorkspaceSid?: number;
    };
    'doc.enrichUntitledDoc': {
      workspaceId: string;
      docId: string;
    };
    'doc.autoFixedDocSummary': {
      workspaceId: string;
      docId: string;
    };
  }
}

@Injectable()
export class DocServiceCronJob {
  private readonly logger = new Logger(DocServiceCronJob.name);

  constructor(
    private readonly workspace: PgWorkspaceDocStorageAdapter,
    private readonly docReader: DatabaseDocReader,
    private readonly docWriter: DocWriter,
    private readonly prisma: PrismaClient,
    private readonly job: JobQueue,
    private readonly models: Models
  ) {}

  @OnJob('doc.mergePendingDocUpdates')
  async mergePendingDocUpdates({
    workspaceId,
    docId,
  }: Jobs['doc.mergePendingDocUpdates']) {
    await this.workspace.getDoc(workspaceId, docId);
    const updatesLeft = await this.models.doc.getUpdateCount(
      workspaceId,
      docId
    );

    return updatesLeft > 100 ? JOB_SIGNAL.Repeat : JOB_SIGNAL.Done;
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async schedule() {
    const group = await this.models.doc.groupedUpdatesCount();

    for (const update of group) {
      const jobId = `doc:merge-pending-updates:${update.workspaceId}:${update.id}`;

      const job = await this.job.get(jobId, 'doc.mergePendingDocUpdates');

      if (job && job.opts.priority !== 0 && update._count > 100) {
        // reschedule long pending doc with highest priority, 0 is the highest priority
        await this.job.remove(jobId, 'doc.mergePendingDocUpdates');
      }

      await this.job.add(
        'doc.mergePendingDocUpdates',
        {
          workspaceId: update.workspaceId,
          docId: update.id,
        },
        {
          jobId: `doc:merge-pending-updates:${update.workspaceId}:${update.id}`,
          priority: update._count > 100 ? 0 : 100,
          delay: 0,
        }
      );
    }
  }

  @OnJob('doc.recordPendingDocUpdatesCount')
  async recordPendingDocUpdatesCount() {
    const count = await this.prisma.update.count();
    metrics.doc.gauge('pending_updates').record(count);
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async scheduleRecordPendingDocUpdatesCount() {
    await this.job.add(
      'doc.recordPendingDocUpdatesCount',
      {},
      {
        // make sure only one job is running at a time
        delay: 30 * 1000,
        jobId: 'doc:record-pending-updates-count',
      }
    );
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async scheduleFindEmptySummaryDocs() {
    await this.job.add(
      'doc.findEmptySummaryDocs',
      {},
      {
        // make sure only one job is running at a time
        delay: 30 * 1000,
        jobId: 'findEmptySummaryDocs',
      }
    );
  }

  @OnJob('doc.findEmptySummaryDocs')
  async findEmptySummaryDocs(payload: Jobs['doc.findEmptySummaryDocs']) {
    const startSid = payload.lastFixedWorkspaceSid ?? 0;
    const workspaces = await this.models.workspace.list(
      { sid: { gt: startSid } },
      { id: true, sid: true },
      100
    );

    if (workspaces.length === 0) {
      return JOB_SIGNAL.Repeat;
    }

    let addedCount = 0;
    for (const workspace of workspaces) {
      const docIds = await this.models.doc.findEmptySummaryDocIds(workspace.id);
      for (const docId of docIds) {
        // ignore root doc
        if (docId === workspace.id) {
          continue;
        }
        await this.job.add(
          'doc.autoFixedDocSummary',
          { workspaceId: workspace.id, docId },
          {
            jobId: `autoFixedDocSummary/${workspace.id}/${docId}`,
          }
        );
        addedCount++;
      }
    }

    const nextSid = workspaces[workspaces.length - 1].sid;
    this.logger.log(
      `Auto added ${addedCount} docs to queue, lastFixedWorkspaceSid: ${startSid} -> ${nextSid}`
    );

    // update the lastFixedWorkspaceSid in the payload and repeat the job after 30 seconds
    payload.lastFixedWorkspaceSid = nextSid;
    return JOB_SIGNAL.Repeat;
  }

  @OnJob('doc.autoFixedDocSummary')
  async autoFixedDocSummary(payload: Jobs['doc.autoFixedDocSummary']) {
    const { workspaceId, docId } = payload;
    const content = await this.docReader.getDocContent(workspaceId, docId);
    if (!content) {
      this.logger.warn(
        `Summary for doc ${docId} in workspace ${workspaceId} not found`
      );
      return;
    }

    await this.models.doc.upsertMeta(workspaceId, docId, content);
    return;
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduleEnrichUntitledDocs() {
    await this.job.add(
      'doc.enrichUntitledDocs',
      {},
      { jobId: 'enrichUntitledDocs' }
    );
  }

  @OnJob('doc.enrichUntitledDocs')
  async enrichUntitledDocs(payload: Jobs['doc.enrichUntitledDocs']) {
    const workspaces = await this.models.workspace.list(
      { sid: { gt: payload.lastWorkspaceSid ?? 0 } },
      { id: true, sid: true },
      100
    );
    if (workspaces.length === 0) {
      return JOB_SIGNAL.Done;
    }

    for (const workspace of workspaces) {
      const docIds = await this.models.doc.findUntitledDocIds(workspace.id);
      for (const docId of docIds) {
        await this.job.add(
          'doc.enrichUntitledDoc',
          { workspaceId: workspace.id, docId },
          { jobId: `enrichUntitledDoc/${workspace.id}/${docId}` }
        );
      }
    }

    payload.lastWorkspaceSid = workspaces[workspaces.length - 1].sid;
    return JOB_SIGNAL.Repeat;
  }

  /**
   * Names an untitled note from its body. A note with neither title nor body
   * is only logged: removing it also means removing its entry from the
   * workspace's root doc, which nothing on the server does yet.
   */
  @OnJob('doc.enrichUntitledDoc')
  async enrichUntitledDoc({
    workspaceId,
    docId,
  }: Jobs['doc.enrichUntitledDoc']) {
    const content = await this.docReader.getFullDocContent(workspaceId, docId);
    if (!content) return;

    const result = enrichDoc({ title: content.title, body: content.summary });
    if (result.action === 'setTitle') {
      await this.docWriter.updateDocMeta(workspaceId, docId, {
        title: result.title,
      });
    } else if (result.action === 'flagEmpty') {
      this.logger.log(`Doc ${docId} in workspace ${workspaceId} is empty`);
    }
  }
}

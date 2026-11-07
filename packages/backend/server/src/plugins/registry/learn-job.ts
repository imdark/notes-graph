import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Config, JOB_SIGNAL, JobQueue, OnJob } from '../../base';
import { DocReader, DocWriter } from '../../core/doc';
import { Models } from '../../models';
import {
  detectLearnings,
  LEARN_DAYS,
  PROPOSALS_FOLDER,
  PROPOSALS_TITLE,
  renderProposals,
  scanRun,
} from './learn';

declare global {
  interface Jobs {
    // A job name starts with its queue, one of base/job/queue/def.ts; a name
    // with an unknown queue throws when the server loads, in every flavor.
    'nightly.learnFromRuns': {
      lastWorkspaceSid?: number;
    };
  }
}

/** Runs read per workspace a night; the rest wait for the next. */
const RUNS_PER_NIGHT = 200;

/**
 * The nightly `wf learn` pass, from the server: counts repeated mistakes over
 * each workspace's recent agent runs and keeps the "Proposed harness changes"
 * note current (CLOUD-92). Runs after the 3am doc enrichment. Proposals
 * only: nothing here touches Agent rules, skills or Agent memory.
 */
@Injectable()
export class AgentLearnService {
  private readonly logger = new Logger(AgentLearnService.name);

  constructor(
    private readonly models: Models,
    private readonly reader: DocReader,
    private readonly writer: DocWriter,
    private readonly job: JobQueue,
    private readonly config: Config
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async scheduleLearnFromRuns() {
    // Off unless configured: it writes a note into every workspace with runs.
    if (!this.config.registry.learn) return;
    await this.job.add('nightly.learnFromRuns', {}, { jobId: 'learnFromRuns' });
  }

  @OnJob('nightly.learnFromRuns')
  async learnFromRuns(payload: Jobs['nightly.learnFromRuns']) {
    const workspaces = await this.models.workspace.list(
      { sid: { gt: payload.lastWorkspaceSid ?? 0 } },
      { id: true, sid: true },
      100
    );
    if (workspaces.length === 0) {
      return JOB_SIGNAL.Done;
    }
    for (const workspace of workspaces) {
      try {
        await this.learnWorkspace(workspace.id);
      } catch (err) {
        // One workspace's note failing must not stop the others.
        this.logger.warn(
          `learn skipped workspace ${workspace.id}: ${(err as Error).message}`
        );
      }
    }
    payload.lastWorkspaceSid = workspaces[workspaces.length - 1].sid;
    return JOB_SIGNAL.Repeat;
  }

  /**
   * Scan the workspace's finished runs and write its proposals note. A
   * workspace with no runs in the window, or no findings and no note yet,
   * gets nothing written.
   */
  async learnWorkspace(workspaceId: string) {
    const since = new Date(Date.now() - LEARN_DAYS * 24 * 3600 * 1000);
    const runs = await this.models.registryJob.listFinishedSince(
      workspaceId,
      since,
      RUNS_PER_NIGHT
    );
    if (runs.length === 0) return null;

    const findings = detectLearnings(runs.map(scanRun));
    const docId = (
      await this.models.doc.findIdsByExactTitle(workspaceId, PROPOSALS_TITLE)
    )[0];
    if (!docId && findings.length === 0) return null;

    const previous = docId
      ? (await this.reader.getDocMarkdown(workspaceId, docId, false))?.markdown
      : null;
    const markdown = renderProposals(findings, {
      runsScanned: runs.length,
      at: new Date(),
      previous,
    });

    if (docId) {
      await this.writer.updateDoc(workspaceId, docId, markdown);
      this.logger.log(
        `learn: ${findings.length} findings from ${runs.length} runs in ${workspaceId}`
      );
      return docId;
    }
    const created = await this.writer.createDoc(
      workspaceId,
      PROPOSALS_TITLE,
      markdown
    );
    await this.writer.fileInFolder(
      workspaceId,
      created.docId,
      PROPOSALS_FOLDER
    );
    this.logger.log(
      `learn: created "${PROPOSALS_TITLE}" with ${findings.length} findings from ${runs.length} runs in ${workspaceId}`
    );
    return created.docId;
  }
}

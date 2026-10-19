import { Injectable, Logger } from '@nestjs/common';
import type { RegistryJob, RegistryJobQuestion } from '@prisma/client';
import { GoogleAuth } from 'google-auth-library';

import { Config, URLHelper } from '../../base';
import { Models } from '../../models';

/** FCM caps a message's data at 4 KB; leave room for keys and the envelope. */
const MAX_DATA_BYTES = 3_500;
const MAX_PUSH_TEXT = 600;
const MAX_PUSH_DETAIL = 1_200;
const MAX_PUSH_OPTION = 80;

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const bytes = (data: Record<string, string>) =>
  Buffer.byteLength(JSON.stringify(data), 'utf8');

/**
 * What the phone needs to show a question and answer it from the
 * notification without opening the app. Data-only (no `notification` key) so
 * the app builds the notification itself, with Allow / Deny / Reply buttons,
 * whether or not it is running.
 */
export function questionPushData(
  serverBaseUrl: string,
  job: Pick<RegistryJob, 'id' | 'workspaceId' | 'agentName' | 'docId'>,
  question: Pick<
    RegistryJobQuestion,
    'id' | 'kind' | 'text' | 'detail' | 'options'
  >
): Record<string, string> {
  const data: Record<string, string> = {
    type: 'agent-question',
    server: serverBaseUrl,
    workspaceId: job.workspaceId,
    jobId: job.id,
    docId: job.docId ?? '',
    questionId: question.id,
    kind: question.kind,
    agentName: job.agentName,
    text: clip(question.text, MAX_PUSH_TEXT),
    detail: clip(question.detail ?? '', MAX_PUSH_DETAIL),
    options: JSON.stringify(
      (question.options ?? []).map(option => clip(option, MAX_PUSH_OPTION))
    ),
  };
  // The tool input is the first thing to give up: the phone can still open
  // the run to see it in full.
  if (bytes(data) > MAX_DATA_BYTES) data.detail = '';
  if (bytes(data) > MAX_DATA_BYTES) data.options = '[]';
  if (bytes(data) > MAX_DATA_BYTES) data.text = clip(data.text, 200);
  return data;
}

export type RunOutcome = 'done' | 'review' | 'deployed' | 'blocked' | 'failed';

/**
 * Where a run ended, as the user would act on it: what still needs them
 * (blocked, review) outranks what shipped, so a run that left one task
 * blocked reads as blocked even if another deployed.
 */
export function runOutcome(
  jobStatus: string,
  taskStatuses: Record<string, string>
): RunOutcome {
  if (jobStatus === 'error') return 'failed';
  const statuses = new Set(
    Object.values(taskStatuses).map(s => s.toUpperCase())
  );
  if (statuses.has('BLOCKED')) return 'blocked';
  if (statuses.has('COMMITTED') || statuses.has('MERGED')) return 'review';
  if (statuses.has('DEPLOYED')) return 'deployed';
  return 'done';
}

/**
 * Whether a finished job is worth a phone notification. Not when the user
 * cancelled it, not a monitor's run (its alert is its own push), and not a
 * health check that passed: those run on a schedule, and only a failure is
 * news. A failed one still pushes.
 */
export function pushesWhenFinished(job: {
  createdBy: string | null;
  status: string;
  agentId: string;
}): boolean {
  if (!job.createdBy || job.status === 'cancelled') return false;
  if (job.agentId.startsWith('monitor:')) return false;
  if (job.agentId.startsWith('health:') && job.status === 'done') return false;
  return true;
}

/** A run ended: enough for the phone to say how, and open its note. */
export function finishedPushData(
  serverBaseUrl: string,
  job: Pick<
    RegistryJob,
    'id' | 'workspaceId' | 'agentName' | 'docId' | 'title' | 'result' | 'error'
  >,
  outcome: RunOutcome
): Record<string, string> {
  const text = outcome === 'failed' ? job.error : job.result;
  return {
    type: 'agent-finished',
    server: serverBaseUrl,
    workspaceId: job.workspaceId,
    jobId: job.id,
    docId: job.docId ?? '',
    agentName: job.agentName,
    title: clip(job.title ?? '', 200),
    outcome,
    text: clip((text ?? '').trim(), MAX_PUSH_DETAIL),
  };
}

/**
 * Tells the phones of whoever started an agent run that it is waiting on
 * them, through Firebase Cloud Messaging.
 *
 * Best effort throughout: a push that never lands leaves the question
 * waiting in the app exactly as before, so nothing here may fail the ask or
 * the answer it rides on.
 */
@Injectable()
export class AgentPushService {
  private readonly logger = new Logger(AgentPushService.name);
  private auth: { raw: string; client: GoogleAuth; projectId: string } | null =
    null;

  constructor(
    private readonly config: Config,
    private readonly models: Models,
    private readonly url: URLHelper
  ) {}

  private credentials() {
    const raw = this.config.registry.fcmServiceAccount?.trim();
    if (!raw) return null;
    if (this.auth?.raw === raw) return this.auth;
    try {
      const key = JSON.parse(raw) as { project_id?: string };
      if (!key.project_id) throw new Error('no project_id');
      this.auth = {
        raw,
        projectId: key.project_id,
        client: new GoogleAuth({
          credentials: key,
          scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
        }),
      };
      return this.auth;
    } catch (err) {
      this.logger.warn(
        `registry.fcmServiceAccount is not a usable key: ${err}`
      );
      return null;
    }
  }

  /** A run asked something: tell its starter's phones. */
  async questionAsked(
    job: RegistryJob,
    question: RegistryJobQuestion
  ): Promise<void> {
    if (!job.createdBy) return;
    await this.send(
      job.createdBy,
      questionPushData(this.url.baseUrl, job, question)
    );
  }

  /**
   * Questions were answered (on any device): take them off the other phones,
   * so nobody is left holding an Allow button for something already decided.
   */
  async questionsClosed(
    job: RegistryJob,
    questionIds: string[]
  ): Promise<void> {
    if (!job.createdBy || questionIds.length === 0) return;
    await this.send(job.createdBy, {
      type: 'agent-question-closed',
      jobId: job.id,
      questionIds: questionIds.join(','),
    });
  }

  /**
   * A run ended, done or failed: tell its starter's phones, saying whether
   * its tasks wait on a review, shipped, or got stuck. A cancelled run was
   * the user's own doing and pushes nothing; a monitor's check runs on a
   * schedule and has its own alert push for what it finds.
   */
  async runFinished(
    job: RegistryJob,
    taskStatuses: Record<string, string>
  ): Promise<void> {
    if (!pushesWhenFinished(job) || !job.createdBy) return;
    await this.send(
      job.createdBy,
      finishedPushData(
        this.url.baseUrl,
        job,
        runOutcome(job.status, taskStatuses)
      )
    );
  }

  /** A monitor's alert, to its owner's phones; opening it goes to the block. */
  async monitorAlert(
    userId: string,
    alert: {
      monitorId: string;
      name: string;
      value: string;
      reason: string;
      workspaceId: string;
      docId: string;
      blockId: string;
    }
  ): Promise<void> {
    await this.send(userId, {
      type: 'monitor-alert',
      server: this.url.baseUrl,
      ...alert,
    });
  }

  private async send(userId: string, data: Record<string, string>) {
    const auth = this.credentials();
    if (!auth) return;
    const tokens = await this.models.userPushToken.listForUser(userId);
    if (tokens.length === 0) return;

    const accessToken = await auth.client.getAccessToken();
    const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(auth.projectId)}/messages:send`;
    const gone: string[] = [];
    await Promise.all(
      tokens.map(async ({ token }) => {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              data,
              // High priority is what wakes a phone in Doze; a question an
              // hour old is better read in the app than as a stale alert.
              android: { priority: 'high', ttl: '3600s' },
            },
          }),
        });
        if (response.ok) return;
        const body = await response.text();
        // 404 / UNREGISTERED: the install is gone. Anything else is ours or
        // FCM's to fix, and the token may still be good.
        if (response.status === 404 || body.includes('UNREGISTERED')) {
          gone.push(token);
        } else {
          this.logger.warn(
            `FCM send failed (${response.status}): ${body.slice(0, 300)}`
          );
        }
      })
    );
    await this.models.userPushToken.removeTokens(gone);
  }
}

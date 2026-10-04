import { Injectable, Logger } from '@nestjs/common';
import type { InventoryJob, InventoryJobQuestion } from '@prisma/client';
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
  job: Pick<InventoryJob, 'id' | 'workspaceId' | 'agentName' | 'docId'>,
  question: Pick<InventoryJobQuestion, 'id' | 'kind' | 'text' | 'detail' | 'options'>
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
    const raw = this.config.inventory.fcmServiceAccount?.trim();
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
      this.logger.warn(`inventory.fcmServiceAccount is not a usable key: ${err}`);
      return null;
    }
  }

  /** A run asked something: tell its starter's phones. */
  async questionAsked(
    job: InventoryJob,
    question: InventoryJobQuestion
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
  async questionsClosed(job: InventoryJob, questionIds: string[]): Promise<void> {
    if (!job.createdBy || questionIds.length === 0) return;
    await this.send(job.createdBy, {
      type: 'agent-question-closed',
      jobId: job.id,
      questionIds: questionIds.join(','),
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
          this.logger.warn(`FCM send failed (${response.status}): ${body.slice(0, 300)}`);
        }
      })
    );
    await this.models.userPushToken.removeTokens(gone);
  }
}

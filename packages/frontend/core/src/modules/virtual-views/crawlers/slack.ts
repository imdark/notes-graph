import { decryptSecret, encryptSecret } from './crypto';
import type { CrawledItem, Crawler, CrawlResult } from './def';
import { proxyFetchJson } from './xml';

const SLACK_API = 'https://slack.com/api';

interface SlackResponse {
  ok: boolean;
  error?: string;
}

async function slack<T extends SlackResponse>(
  token: string,
  method: string,
  params: Record<string, string> = {}
): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `${SLACK_API}/${method}${qs ? `?${qs}` : ''}`;
  const data = await proxyFetchJson<T>(url, `Bearer ${token}`);
  if (!data.ok) {
    throw new Error(`Slack: ${data.error ?? 'request failed'}`);
  }
  return data;
}

/** Lightly de-mrkdwn Slack message text for display. */
function cleanText(text: string): string {
  return text
    .replace(/<@[\w]+>/g, '@user')
    .replace(/<#[\w]+\|([^>]+)>/g, '#$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function parseInput(input: string): { token: string; channel: string } {
  const parts = input.trim().split(/\s+/);
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(
      'Enter a Slack token and a channel id, separated by a space (e.g. "xoxb-… C0123ABCD")'
    );
  }
  return { token: parts[0], channel: parts[1] };
}

/**
 * Crawls a Slack channel's recent messages via the Web API. Uses a token the
 * user supplies (a bot/user token from a Slack app with `channels:history` +
 * `conversations.info`) — no OAuth dance. The token is stored in the view
 * config on the local (offline) DB.
 */
export const slackCrawler: Crawler = {
  type: 'slack',

  async parse(input) {
    const { token, channel } = parseInput(input);
    const auth = await slack<SlackResponse & { team?: string; url?: string }>(
      token,
      'auth.test'
    );
    const info = await slack<
      SlackResponse & { channel?: { name?: string } }
    >(token, 'conversations.info', { channel });
    return {
      config: {
        // Encrypted at rest with a device-local key (see crypto.ts).
        token: await encryptSecret(token),
        channel,
        teamUrl: auth.url?.replace(/\/+$/, '') ?? '',
      },
      name: `Slack #${info.channel?.name ?? channel}`,
    };
  },

  async crawl(config): Promise<CrawlResult> {
    const token = await decryptSecret(String(config.token ?? ''));
    const channel = String(config.channel ?? '');
    const teamUrl = String(config.teamUrl ?? '');
    if (!token || !channel) {
      throw new Error('Invalid Slack config');
    }
    const res = await slack<
      SlackResponse & {
        messages?: Array<{ ts: string; text?: string }>;
      }
    >(token, 'conversations.history', { channel, limit: '30' });

    const items: CrawledItem[] = (res.messages ?? [])
      .filter(message => !!message.text)
      .map(message => {
        const text = cleanText(message.text ?? '');
        const tsId = message.ts.replace('.', '');
        return {
          externalId: message.ts,
          title: text.split('\n')[0].slice(0, 100) || 'Message',
          url: teamUrl ? `${teamUrl}/archives/${channel}/p${tsId}` : '',
          snippet: text.slice(0, 300),
          publishedAt: Math.floor(Number(message.ts) * 1000),
        };
      })
      .filter(item => !!item.url);

    return { items };
  },
};

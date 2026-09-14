import { decryptSecret } from './crypto';
import type { CrawledItem, Crawler, CrawlResult } from './def';
import { getGoogleAccessToken } from './google-oauth';
import { proxyFetchJson } from './xml';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailHeader {
  name: string;
  value: string;
}

/**
 * Crawls Gmail via the API using a stored OAuth refresh token (+ client
 * credentials). Portable across devices — no app password — but requires a
 * Google Cloud OAuth client and a one-time consent to obtain the refresh
 * token. Client secret and refresh token are encrypted at rest.
 */
export const gmailCrawler: Crawler = {
  type: 'gmail',

  async crawl(config): Promise<CrawlResult> {
    const clientId = String(config.clientId ?? '');
    const clientSecret = await decryptSecret(String(config.clientSecret ?? ''));
    const refreshToken = await decryptSecret(String(config.refreshToken ?? ''));
    const query = String(config.query || 'in:inbox');

    const accessToken = await getGoogleAccessToken(
      clientId,
      clientSecret,
      refreshToken
    );
    const auth = `Bearer ${accessToken}`;

    const list = await proxyFetchJson<{ messages?: Array<{ id: string }> }>(
      `${GMAIL_API}/messages?maxResults=30&q=${encodeURIComponent(query)}`,
      auth
    );
    const ids = (list.messages ?? []).map(message => message.id);

    const items = await Promise.all(
      ids.map(async (id): Promise<CrawledItem> => {
        const msg = await proxyFetchJson<{
          snippet?: string;
          internalDate?: string;
          payload?: { headers?: GmailHeader[] };
        }>(
          `${GMAIL_API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          auth
        );
        const headers = msg.payload?.headers ?? [];
        const header = (name: string) =>
          headers.find(h => h.name === name)?.value;
        const dateHeader = header('Date');
        return {
          externalId: id,
          title: header('Subject') ?? '(no subject)',
          url: `https://mail.google.com/mail/u/0/#all/${id}`,
          snippet: msg.snippet ?? header('From'),
          publishedAt: dateHeader
            ? new Date(dateHeader).getTime()
            : msg.internalDate
              ? Number(msg.internalDate)
              : undefined,
        };
      })
    );

    return { name: 'Gmail', items };
  },
};

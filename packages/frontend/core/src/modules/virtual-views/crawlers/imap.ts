import { getLinkCardBaseUrl } from '../../link-card';
import { decryptSecret } from './crypto';
import type { CrawledItem, Crawler, CrawlResult } from './def';

interface ImapMessage {
  uid: number;
  from: string;
  fromName: string;
  subject: string;
  date: number | null;
}

/**
 * Reads a mailbox over IMAP through the sidecar's `/clip/imap` endpoint (the
 * browser can't speak IMAP). Works with any provider via an app password —
 * no OAuth. Credentials are stored on the local view config; the password is
 * encrypted at rest.
 */
export const imapCrawler: Crawler = {
  type: 'imap',

  async crawl(config): Promise<CrawlResult> {
    const password = await decryptSecret(String(config.password ?? ''));
    const res = await fetch(`${getLinkCardBaseUrl()}/clip/imap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host: config.host,
        port: config.port,
        secure: config.secure ?? true,
        user: config.user,
        pass: password,
        mailbox: config.mailbox || 'INBOX',
        limit: 30,
      }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error ?? `IMAP fetch failed (${res.status})`);
    }
    const { messages } = (await res.json()) as { messages: ImapMessage[] };
    const items: CrawledItem[] = messages.map(message => ({
      externalId: String(message.uid),
      title: message.subject || '(no subject)',
      // IMAP has no web permalink — items open nothing.
      url: '',
      snippet: message.fromName
        ? `${message.fromName} <${message.from}>`
        : message.from,
      publishedAt: message.date ?? undefined,
    }));
    return { items };
  },
};

import { decryptSecret } from './crypto';
import type { CrawledItem, Crawler, CrawlResult } from './def';
import { getGoogleAccessToken } from './google-oauth';
import { proxyFetchJson } from './xml';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

interface DriveFile {
  id: string;
  name: string;
  webViewLink?: string;
  modifiedTime?: string;
  mimeType?: string;
}

/**
 * Lists Google Drive files via the Drive API using a stored OAuth refresh
 * token (with a Drive scope). Same auth model as the Gmail crawler; secrets
 * are encrypted at rest.
 */
export const gdriveCrawler: Crawler = {
  type: 'gdrive',

  async crawl(config): Promise<CrawlResult> {
    const clientId = String(config.clientId ?? '');
    const clientSecret = await decryptSecret(String(config.clientSecret ?? ''));
    const refreshToken = await decryptSecret(String(config.refreshToken ?? ''));
    // Default: recent, non-trashed files owned by / shared with the user.
    const query = String(config.query || 'trashed = false');

    const accessToken = await getGoogleAccessToken(
      clientId,
      clientSecret,
      refreshToken
    );

    const params = new URLSearchParams({
      q: query,
      orderBy: 'modifiedTime desc',
      pageSize: '30',
      fields: 'files(id,name,webViewLink,modifiedTime,mimeType)',
    });
    const res = await proxyFetchJson<{ files?: DriveFile[] }>(
      `${DRIVE_API}?${params.toString()}`,
      `Bearer ${accessToken}`
    );

    const items: CrawledItem[] = (res.files ?? []).map(file => ({
      externalId: file.id,
      title: file.name || '(untitled)',
      url: file.webViewLink ?? `https://drive.google.com/open?id=${file.id}`,
      snippet: file.mimeType?.replace('application/vnd.google-apps.', ''),
      publishedAt: file.modifiedTime
        ? new Date(file.modifiedTime).getTime()
        : undefined,
    }));
    return { name: 'Google Drive', items };
  },
};

import type { Crawler, CrawlResult } from './def';
import { decodeXml, proxyFetchText, tagText } from './xml';

const CHANNEL_ID_RE = /^UC[\w-]{20,}$/;

/**
 * Resolve arbitrary channel input (a channel id, a `/channel/UC…` or feed URL,
 * or a `@handle` / custom URL) to a bare channel id.
 */
async function resolveChannelId(input: string): Promise<string> {
  const trimmed = input.trim();
  if (CHANNEL_ID_RE.test(trimmed)) {
    return trimmed;
  }
  const channelIdParam = trimmed.match(/[?&]channel_id=(UC[\w-]{20,})/);
  if (channelIdParam) {
    return channelIdParam[1];
  }
  const channelPath = trimmed.match(/\/channel\/(UC[\w-]{20,})/);
  if (channelPath) {
    return channelPath[1];
  }
  // A handle / custom URL — fetch the page and scrape the canonical channel id.
  const pageUrl = /^https?:\/\//.test(trimmed)
    ? trimmed
    : `https://www.youtube.com/${trimmed.replace(/^\/+/, '')}`;
  const html = await proxyFetchText(pageUrl);
  const fromMeta = html.match(/"channelId":"(UC[\w-]{20,})"/);
  if (fromMeta) {
    return fromMeta[1];
  }
  const fromCanonical = html.match(
    /<link[^>]+rel="canonical"[^>]+href="[^"]*\/channel\/(UC[\w-]{20,})"/
  );
  if (fromCanonical) {
    return fromCanonical[1];
  }
  throw new Error('Could not resolve a YouTube channel from that input');
}

function feedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

export const youtubeCrawler: Crawler = {
  type: 'youtube',

  async parse(input: string) {
    const channelId = await resolveChannelId(input);
    // Grab the channel title from the feed's top-level <title>.
    const xml = await proxyFetchText(feedUrl(channelId));
    const name = xml.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    return {
      config: { channelId },
      name: name ? decodeXml(name) : undefined,
    };
  },

  async crawl(config): Promise<CrawlResult> {
    const channelId = String(config.channelId ?? '');
    if (!CHANNEL_ID_RE.test(channelId)) {
      throw new Error('Invalid YouTube channel config');
    }
    const xml = await proxyFetchText(feedUrl(channelId));
    const channelName = decodeXml(
      xml.replace(/<entry[\s\S]*$/, '').match(/<title>([\s\S]*?)<\/title>/)?.[1] ??
        ''
    );
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
    const items = entries.map(entry => {
      const videoId =
        tagText(entry, 'yt:videoId') ?? tagText(entry, 'id') ?? '';
      const published = tagText(entry, 'published');
      const mediaDesc = entry.match(
        /<media:description>([\s\S]*?)<\/media:description>/
      )?.[1];
      const thumb = entry.match(/<media:thumbnail[^>]+url="([^"]+)"/)?.[1];
      return {
        externalId: videoId,
        title: tagText(entry, 'title') ?? 'Untitled',
        url: videoId
          ? `https://www.youtube.com/watch?v=${videoId}`
          : (tagText(entry, 'link') ?? ''),
        snippet: mediaDesc ? decodeXml(mediaDesc).slice(0, 300) : undefined,
        thumbnail: thumb,
        publishedAt: published ? new Date(published).getTime() : undefined,
      };
    });
    return { name: channelName || undefined, items };
  },
};

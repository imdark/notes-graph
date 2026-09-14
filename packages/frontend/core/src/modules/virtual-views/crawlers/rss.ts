import type { CrawledItem, Crawler, CrawlResult } from './def';
import { proxyFetchText, tagAttr, tagText, textSnippet } from './xml';

/** Feed/channel title — the first <title> before the first item/entry. */
function feedTitle(xml: string): string | undefined {
  const head = xml.replace(/<(item|entry)[\s\S]*$/i, '');
  return tagText(head, 'title');
}

function parseAtomEntry(entry: string): CrawledItem {
  const id = tagText(entry, 'id');
  const alt = entry.match(
    /<link[^>]*rel="alternate"[^>]*href="([^"]*)"/
  )?.[1];
  const url = alt ?? tagAttr(entry, 'link', 'href') ?? '';
  const title = tagText(entry, 'title') ?? 'Untitled';
  const summary =
    entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ??
    entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1];
  const published = tagText(entry, 'published') ?? tagText(entry, 'updated');
  return {
    externalId: id || url || title,
    title,
    url,
    snippet: summary ? textSnippet(summary) : undefined,
    publishedAt: published ? new Date(published).getTime() : undefined,
  };
}

function parseRssItem(item: string): CrawledItem {
  const guid = tagText(item, 'guid');
  const link = tagText(item, 'link');
  const title = tagText(item, 'title') ?? 'Untitled';
  const desc = item.match(/<description[^>]*>([\s\S]*?)<\/description>/)?.[1];
  const pub = tagText(item, 'pubDate') ?? tagText(item, 'dc:date');
  return {
    externalId: guid ?? link ?? title,
    title,
    url: link ?? guid ?? '',
    snippet: desc ? textSnippet(desc) : undefined,
    publishedAt: pub ? new Date(pub).getTime() : undefined,
  };
}

/** Generic RSS 2.0 / Atom feed crawler (blogs, news, podcasts, releases…). */
export const rssCrawler: Crawler = {
  type: 'rss',

  async parse(input) {
    const url = input.trim();
    if (!/^https?:\/\//.test(url)) {
      throw new Error('Enter a full feed URL (https://…)');
    }
    const xml = await proxyFetchText(url);
    if (!/<rss|<feed|<rdf:RDF/i.test(xml)) {
      throw new Error('That URL does not look like an RSS or Atom feed');
    }
    return { config: { url }, name: feedTitle(xml) };
  },

  async crawl(config): Promise<CrawlResult> {
    const url = String(config.url ?? '');
    if (!url) {
      throw new Error('Invalid feed config');
    }
    const xml = await proxyFetchText(url);
    const name = feedTitle(xml);
    const entries = xml.match(/<entry[\s\S]*?<\/entry>/g);
    if (entries?.length) {
      return { name, items: parseWithUrl(entries.map(parseAtomEntry)) };
    }
    const items = (xml.match(/<item[\s\S]*?<\/item>/g) ?? []).map(parseRssItem);
    return { name, items: parseWithUrl(items) };
  },
};

function parseWithUrl(items: CrawledItem[]): CrawledItem[] {
  return items.filter(item => !!item.url);
}

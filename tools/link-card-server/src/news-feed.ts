/**
 * The Discover feed's news, per topic, shared by every client. A topic is a
 * Google News RSS search; its parsed items are kept for NEWS_FEED_TTL_MS so a
 * client opening Discover reads them from here instead of pulling the RSS
 * itself. The daily "Preseed the Discover feed" automation asks for each
 * topic with `refresh` in the morning and then resolves the items' images,
 * so the first visit of the day finds both waiting.
 */

export interface NewsFeedItem {
  title: string;
  link: string;
  source: string;
  /** Epoch ms, when the feed gave a date. */
  publishedAt?: number;
  /** The article's preview image, when one is already resolved. */
  image?: string;
}

export interface NewsFeed {
  topic: string;
  fetchedAt: number;
  items: NewsFeedItem[];
}

export const NEWS_FEED_TTL_MS = 3 * 3600 * 1000;

export function googleNewsRssUrl(topic: string): string {
  const q = encodeURIComponent(topic);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tagText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXml(match[1]) : undefined;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The <item> entries of a Google News RSS document. */
export function parseGoogleNewsRss(xml: string): NewsFeedItem[] {
  const items: NewsFeedItem[] = [];
  const parts = xml.split('<item>');
  for (let i = 1; i < parts.length; i++) {
    const body = parts[i].split('</item>')[0];
    const rawTitle = tagText(body, 'title');
    const link = tagText(body, 'link');
    if (!rawTitle || !link) continue;
    const source = tagText(body, 'source');
    const pubDate = tagText(body, 'pubDate');
    // Google News titles are "Headline - Source"; drop the trailing source.
    let title = rawTitle;
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3)).trim();
    }
    const publishedAt = pubDate ? Date.parse(pubDate) || undefined : undefined;
    items.push({
      title,
      link,
      source: source || hostFromUrl(link),
      ...(publishedAt ? { publishedAt } : {}),
    });
  }
  return items;
}

export interface NewsFeedDeps {
  fetchText: (url: string) => Promise<string>;
  /** An already resolved image for a headline, without resolving one. */
  cachedImage: (title: string, source: string) => string | null | undefined;
  now?: () => number;
}

export class NewsFeedCache {
  private readonly feeds = new Map<string, NewsFeed>();
  private readonly inflight = new Map<string, Promise<NewsFeed>>();

  constructor(private readonly deps: NewsFeedDeps) {}

  private now() {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /**
   * The topic's feed, from the cache while it is fresh; `refresh` pulls a new
   * one regardless. Images resolved since the feed was pulled are filled in
   * on every read.
   */
  async get(topic: string, refresh = false): Promise<NewsFeed> {
    const key = topic.trim().toLowerCase();
    const hit = this.feeds.get(key);
    let feed: NewsFeed;
    if (!refresh && hit && this.now() - hit.fetchedAt < NEWS_FEED_TTL_MS) {
      feed = hit;
    } else {
      let pending = this.inflight.get(key);
      if (!pending) {
        pending = this.deps
          .fetchText(googleNewsRssUrl(topic.trim()))
          .then(xml => {
            const fresh: NewsFeed = {
              topic: topic.trim(),
              fetchedAt: this.now(),
              items: parseGoogleNewsRss(xml),
            };
            this.feeds.set(key, fresh);
            return fresh;
          })
          .finally(() => this.inflight.delete(key));
        this.inflight.set(key, pending);
      }
      feed = await pending;
    }
    return {
      ...feed,
      items: feed.items.map(item => {
        const image = this.deps.cachedImage(item.title, item.source);
        return image ? { ...item, image } : item;
      }),
    };
  }
}

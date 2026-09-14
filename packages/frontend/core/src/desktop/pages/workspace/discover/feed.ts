import type { Memento } from '@notesgraph/infra';

import { linkCardNewsImageEndpoint } from '../../../../modules/link-card';
import {
  proxyFetchText,
  tagText,
} from '../../../../modules/virtual-views/crawlers/xml';

export interface DiscoverItem {
  /** Stable id (the article link). */
  id: string;
  title: string;
  link: string;
  source: string;
  snippet?: string;
  /** Epoch ms, if the feed gave a date. */
  publishedAt?: number;
  /** The interest topic this item came from. */
  topic: string;
}

const TOPICS_KEY = 'notesgraph:discover:topics';

export const DEFAULT_TOPICS = [
  'Technology',
  'Artificial intelligence',
  'Science',
];

/** The user's interest topics (manual list), persisted in localStorage. */
export function loadTopics(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(TOPICS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .filter((t): t is string => typeof t === 'string')
          .map(t => t.trim())
          .filter(Boolean);
        if (cleaned.length) return cleaned;
      }
    }
  } catch {
    // ignore malformed storage
  }
  return DEFAULT_TOPICS;
}

export function saveTopics(topics: string[]): void {
  const cleaned = topics.map(t => t.trim()).filter(Boolean);
  try {
    globalThis.localStorage?.setItem(TOPICS_KEY, JSON.stringify(cleaned));
  } catch {
    // ignore (private mode / worker)
  }
}

/** Parse a comma / newline separated topic string into a unique list. */
export function parseTopicsInput(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[,\n]/)) {
    const t = part.trim();
    const key = t.toLowerCase();
    if (t && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

function googleNewsRssUrl(topic: string): string {
  const q = encodeURIComponent(topic);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Parse the <item> entries of a Google News RSS document. */
function parseRss(xml: string, topic: string): DiscoverItem[] {
  const items: DiscoverItem[] = [];
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

    // Note: Google News <description> is just the headline + source repeated,
    // so we deliberately don't surface it as a snippet.
    items.push({
      id: link,
      title,
      link,
      source: source || hostFromUrl(link),
      publishedAt: pubDate ? Date.parse(pubDate) || undefined : undefined,
      topic,
    });
  }
  return items;
}

/**
 * Fetch and merge the discover feed for the given interest topics. Each topic
 * is a Google News RSS search, fetched server-side through the link-card
 * sidecar (no CORS). Results are de-duplicated by headline and sorted newest
 * first. A failing topic is skipped, not fatal.
 */
export async function fetchDiscoverFeed(
  topics: string[]
): Promise<DiscoverItem[]> {
  const settled = await Promise.allSettled(
    topics.map(topic =>
      proxyFetchText(googleNewsRssUrl(topic)).then(xml => parseRss(xml, topic))
    )
  );

  const byKey = new Map<string, DiscoverItem>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value) {
      const key = item.title.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!byKey.has(key)) byKey.set(key, item);
    }
  }

  return [...byKey.values()]
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .slice(0, MAX_FEED_ITEMS);
}

/** Cap the merged feed so a broad topic set doesn't render hundreds of cards. */
const MAX_FEED_ITEMS = 80;

const FEED_CACHE_PREFIX = 'discover:feed:v1:';
/** A pulled feed stays fresh for a day; older than this we pull a new one. */
export const FEED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CachedFeed {
  items: DiscoverItem[];
  fetchedAt: number;
}

/**
 * The last feed pulled for this exact topic set, with the time it was pulled.
 * Lets the page render instantly on revisit and only re-pull when the feed is
 * older than a day ("pull a new feed daily").
 */
export function loadCachedFeed(
  cache: Memento,
  topicsKey: string
): CachedFeed | null {
  const value = cache.get<CachedFeed>(FEED_CACHE_PREFIX + topicsKey);
  if (
    value &&
    Array.isArray(value.items) &&
    typeof value.fetchedAt === 'number'
  ) {
    return value;
  }
  return null;
}

export function saveCachedFeed(
  cache: Memento,
  topicsKey: string,
  items: DiscoverItem[]
): void {
  cache.set<CachedFeed>(FEED_CACHE_PREFIX + topicsKey, {
    items,
    fetchedAt: Date.now(),
  });
}

// Bump the version to invalidate old cached values (e.g. earlier sidecar-render
// URLs) when the resolution logic changes.
const CACHE_PREFIX = 'discover:image:v3:';
const inflight = new Map<string, Promise<string | null>>();

/**
 * The article's preview image. The heavy lifting (searching for the real URL,
 * reading its og:image, throttling and a shared cross-client cache) lives on
 * the sidecar's /clip/news-image; here we just call it and keep a thin
 * per-client GlobalCache so a repeat visit doesn't even round-trip. Only
 * successes are persisted; misses return null and retry next visit. Returns
 * null when there is no image.
 */
export async function fetchCardImage(
  item: DiscoverItem,
  cache: Memento
): Promise<string | null> {
  const key = CACHE_PREFIX + item.id;
  const cached = cache.get<string>(key);
  if (cached !== undefined) return cached;

  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(
          linkCardNewsImageEndpoint(item.title, item.source)
        );
        if (!res.ok) return null;
        const data = (await res.json()) as { image?: string | null };
        return data.image ?? null;
      } catch {
        return null;
      }
    })()
      .then(img => {
        if (img) cache.set(key, img);
        return img;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

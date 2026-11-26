import type {
  VirtualItem,
  VirtualView,
} from '../../../../modules/virtual-views';
import type { DiscoverItem } from './feed';

/** The chip shown on a record's card, by virtual view type. */
const TYPE_LABEL: Record<string, string> = {
  gmail: 'Email',
  imap: 'Email',
  slack: 'Slack',
  youtube: 'YouTube',
  rss: 'RSS',
  gdrive: 'Drive',
};

/** Records mixed into the feed, newest first; older ones stay in their folder. */
export const MAX_FEED_RECORDS = 30;

/** One record goes in after every this-many news items. */
export const NEWS_PER_RECORD = 2;

/**
 * Turn crawled virtual-folder items (emails, Slack messages, videos…) into
 * feed cards. Trackers hold readings, not records, so they are left out, and
 * so are items whose folder no longer exists.
 */
export function virtualItemsToFeed(
  items: VirtualItem[],
  views: VirtualView[]
): DiscoverItem[] {
  const viewsById = new Map(views.map(view => [view.id, view]));
  const records: DiscoverItem[] = [];
  for (const item of items) {
    const view = viewsById.get(item.viewId);
    if (!view || view.type === 'tracker' || !item.title) continue;
    records.push({
      id: `virtual:${item.id}`,
      title: item.title,
      link: item.url,
      source: view.name,
      snippet: item.snippet ?? undefined,
      publishedAt: item.publishedAt ?? undefined,
      topic: TYPE_LABEL[view.type] ?? view.type,
      origin: 'record',
      thumbnail: item.thumbnail ?? undefined,
    });
  }
  return records
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .slice(0, MAX_FEED_RECORDS);
}

/**
 * Mix records into the news: one record after every `newsPerRecord` news
 * items, each list keeping its own order. Whatever is left of the longer list
 * goes at the end, so nothing is dropped.
 */
export function interleaveFeed(
  news: DiscoverItem[],
  records: DiscoverItem[],
  newsPerRecord = NEWS_PER_RECORD
): DiscoverItem[] {
  const out: DiscoverItem[] = [];
  let n = 0;
  let r = 0;
  while (n < news.length && r < records.length) {
    out.push(...news.slice(n, n + newsPerRecord));
    n += newsPerRecord;
    out.push(records[r++]);
  }
  out.push(...news.slice(n), ...records.slice(r));
  return out;
}

/**
 * Fold an updated feed into the one on screen without moving what the user
 * is reading: cards already shown keep their place, and only cards not shown
 * yet go at the end (news and records mixed as usual). Returns `shown` itself
 * when nothing is new.
 */
export function appendNewToFeed(
  shown: DiscoverItem[],
  next: DiscoverItem[]
): DiscoverItem[] {
  const seen = new Set(shown.map(item => item.id));
  const fresh = next.filter(item => !seen.has(item.id));
  if (fresh.length === 0) return shown;
  return [
    ...shown,
    ...interleaveFeed(
      fresh.filter(item => item.origin !== 'record'),
      fresh.filter(item => item.origin === 'record')
    ),
  ];
}

/** The feed on screen, and the user selection its news was loaded for. */
export interface ShownFeed {
  selection: string | null;
  items: DiscoverItem[];
}

/**
 * The next feed to show. When the news was loaded for a different selection
 * (the user changed topics or interests), the feed starts over; any other
 * update (a background refresh, a re-crawled record) only appends.
 */
export function nextShownFeed(
  prev: ShownFeed,
  selection: string | null,
  next: DiscoverItem[]
): ShownFeed {
  if (prev.selection !== selection) return { selection, items: next };
  const items = appendNewToFeed(prev.items, next);
  return items === prev.items ? prev : { selection, items };
}

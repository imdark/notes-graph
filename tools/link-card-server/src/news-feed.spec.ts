import { describe, expect, test } from 'vitest';

import {
  googleNewsRssUrl,
  NEWS_FEED_TTL_MS,
  NewsFeedCache,
  parseGoogleNewsRss,
} from './news-feed';

const rss = (titles: string[]) =>
  '<rss><channel><title>x</title>' +
  titles
    .map(
      (t, i) =>
        `<item><title>${t} - Example News</title><link>https://news.google.com/rss/articles/${i}</link>` +
        `<pubDate>Tue, 24 Nov 2026 0${i}:00:00 GMT</pubDate><source url="https://example.com">Example News</source></item>`
    )
    .join('') +
  '</channel></rss>';

describe('parseGoogleNewsRss', () => {
  test('reads title (without its source), link, source and date', () => {
    expect(parseGoogleNewsRss(rss(['Chips &amp; dips']))).toEqual([
      {
        title: 'Chips & dips',
        link: 'https://news.google.com/rss/articles/0',
        source: 'Example News',
        publishedAt: Date.parse('2026-11-24T00:00:00Z'),
      },
    ]);
  });

  test('skips items with no link', () => {
    expect(
      parseGoogleNewsRss('<item><title>Only a title</title></item>')
    ).toEqual([]);
  });
});

describe('NewsFeedCache', () => {
  function setup(images: Record<string, string> = {}) {
    let now = 1_000_000;
    const pulled: string[] = [];
    const cache = new NewsFeedCache({
      fetchText: async url => {
        pulled.push(url);
        return rss(['A', 'B']);
      },
      cachedImage: title => images[title] ?? null,
      now: () => now,
    });
    return { cache, pulled, images, tick: (ms: number) => (now += ms) };
  }

  test('serves a topic from the cache while it is fresh', async () => {
    const { cache, pulled, tick } = setup();
    await cache.get('Science');
    tick(NEWS_FEED_TTL_MS - 1);
    await cache.get(' science ');
    expect(pulled).toEqual([googleNewsRssUrl('Science')]);
    tick(2);
    await cache.get('Science');
    expect(pulled).toHaveLength(2);
  });

  test('refresh pulls anew and concurrent reads share one pull', async () => {
    const { cache, pulled } = setup();
    await cache.get('Science');
    await Promise.all([
      cache.get('Science', true),
      cache.get('Science', true),
    ]);
    expect(pulled).toHaveLength(2);
  });

  test('fills in images resolved after the feed was pulled', async () => {
    const { cache, images } = setup();
    const first = await cache.get('Science');
    expect(first.items.map(i => i.image)).toEqual([undefined, undefined]);
    images.B = 'https://img/b';
    const second = await cache.get('Science');
    expect(second.items.map(i => i.image)).toEqual([
      undefined,
      'https://img/b',
    ]);
  });
});

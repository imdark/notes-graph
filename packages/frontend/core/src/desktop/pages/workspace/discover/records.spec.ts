import { describe, expect, test } from 'vitest';

import type {
  VirtualItem,
  VirtualView,
} from '../../../../modules/virtual-views';
import type { DiscoverItem } from './feed';
import {
  appendNewToFeed,
  interleaveFeed,
  MAX_FEED_RECORDS,
  nextShownFeed,
  virtualItemsToFeed,
} from './records';

const view = (id: string, type: string, name = id): VirtualView => ({
  id,
  type,
  name,
  config: {},
  createdAt: 0,
});

const item = (
  viewId: string,
  externalId: string,
  publishedAt?: number
): VirtualItem => ({
  id: `${viewId}:${externalId}`,
  viewId,
  externalId,
  title: `title ${externalId}`,
  url: `https://example.com/${externalId}`,
  snippet: null,
  thumbnail: null,
  publishedAt,
});

const news = (id: string): DiscoverItem => ({
  id,
  title: id,
  link: id,
  source: 'news',
  topic: 'Tech',
});

describe('virtualItemsToFeed', () => {
  test('maps records from email and Slack folders, newest first', () => {
    const feed = virtualItemsToFeed(
      [item('mail', 'a', 1), item('chat', 'b', 3), item('mail', 'c', 2)],
      [view('mail', 'gmail', 'Work inbox'), view('chat', 'slack', '#eng')]
    );
    expect(feed.map(r => r.id)).toEqual([
      'virtual:chat:b',
      'virtual:mail:c',
      'virtual:mail:a',
    ]);
    expect(feed[0]).toMatchObject({
      source: '#eng',
      topic: 'Slack',
      origin: 'record',
      link: 'https://example.com/b',
    });
    expect(feed[1].topic).toBe('Email');
  });

  test('leaves out trackers and items whose folder is gone', () => {
    const feed = virtualItemsToFeed(
      [item('price', 'p', 1), item('deleted', 'd', 2), item('mail', 'm', 3)],
      [view('price', 'tracker'), view('mail', 'imap')]
    );
    expect(feed.map(r => r.id)).toEqual(['virtual:mail:m']);
  });

  test('caps the number of records', () => {
    const many = Array.from({ length: MAX_FEED_RECORDS + 5 }, (_, i) =>
      item('mail', String(i), i)
    );
    const feed = virtualItemsToFeed(many, [view('mail', 'gmail')]);
    expect(feed).toHaveLength(MAX_FEED_RECORDS);
    expect(feed[0].id).toBe(`virtual:mail:${MAX_FEED_RECORDS + 4}`);
  });
});

describe('interleaveFeed', () => {
  test('puts one record after every two news items', () => {
    const out = interleaveFeed(
      ['n1', 'n2', 'n3', 'n4', 'n5'].map(news),
      ['r1', 'r2'].map(news)
    );
    expect(out.map(i => i.id)).toEqual([
      'n1',
      'n2',
      'r1',
      'n3',
      'n4',
      'r2',
      'n5',
    ]);
  });

  test('appends leftover records when the news runs out', () => {
    const out = interleaveFeed([news('n1')], ['r1', 'r2'].map(news));
    expect(out.map(i => i.id)).toEqual(['n1', 'r1', 'r2']);
  });

  test('shows records alone when there is no news', () => {
    expect(interleaveFeed([], [news('r1')]).map(i => i.id)).toEqual(['r1']);
  });
});

const record = (id: string): DiscoverItem => ({
  ...news(id),
  origin: 'record',
});
const ids = (items: DiscoverItem[]) => items.map(i => i.id);

describe('appendNewToFeed', () => {
  test('keeps shown cards in place and appends only new ones', () => {
    const shown = [news('n1'), news('n2'), record('r1')];
    const refreshed = [news('n3'), news('n1'), record('r2'), news('n4')];
    expect(ids(appendNewToFeed(shown, refreshed))).toEqual([
      'n1',
      'n2',
      'r1',
      'n3',
      'n4',
      'r2',
    ]);
  });

  test('keeps cards the update no longer has', () => {
    const shown = [news('n1'), news('n2')];
    expect(ids(appendNewToFeed(shown, [news('n3')]))).toEqual([
      'n1',
      'n2',
      'n3',
    ]);
  });

  test('returns the same list when nothing is new', () => {
    const shown = [news('n1'), record('r1')];
    expect(appendNewToFeed(shown, [record('r1')])).toBe(shown);
  });
});

describe('nextShownFeed', () => {
  test('starts over when the news is for a new selection', () => {
    const prev = { selection: 'a', items: [news('n1')] };
    expect(ids(nextShownFeed(prev, 'b', [news('n2')]).items)).toEqual(['n2']);
  });

  test('appends when the selection is unchanged', () => {
    const prev = { selection: 'a', items: [news('n1')] };
    expect(ids(nextShownFeed(prev, 'a', [news('n2')]).items)).toEqual([
      'n1',
      'n2',
    ]);
  });

  test('replaces records shown before the first news arrived', () => {
    const prev = { selection: null, items: [record('r1')] };
    const next = [news('n1'), news('n2'), record('r1')];
    expect(ids(nextShownFeed(prev, 'a', next).items)).toEqual([
      'n1',
      'n2',
      'r1',
    ]);
  });
});

import { describe, expect, test } from 'vitest';

import {
  fetchServerTopics,
  isFeedStale,
  saveServerTopics,
  type ServerFetch,
  sharedFeedItems,
  topicOptions,
  uniqueTopics,
} from './feed';

describe('server topics', () => {
  const answering = (body: unknown) => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetch: ServerFetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify(body));
    };
    return { fetch, calls };
  };

  test('reads the saved selection, null when there is none', async () => {
    const saved = answering({ topics: ['Rust', ' rust ', 'Chess', 3] });
    expect(await fetchServerTopics(saved.fetch)).toEqual(['Rust', 'Chess']);
    expect(saved.calls[0].input).toBe('/api/notes/discover/topics');
    expect(await fetchServerTopics(answering({ topics: null }).fetch)).toBe(
      null
    );
    expect(await fetchServerTopics(answering({ topics: [] }).fetch)).toEqual(
      []
    );
  });

  test('saves the selection de-duplicated', async () => {
    const server = answering({});
    await saveServerTopics(server.fetch, ['Rust', 'RUST', 'Chess']);
    expect(server.calls[0].init?.method).toBe('PUT');
    expect(JSON.parse(String(server.calls[0].init?.body))).toEqual({
      topics: ['Rust', 'Chess'],
    });
  });
});

describe('sharedFeedItems', () => {
  test('keeps well-formed items with their image and drops the rest', () => {
    expect(
      sharedFeedItems(
        {
          items: [
            {
              title: 'Chips',
              link: 'https://www.example.com/a',
              source: '',
              publishedAt: 5,
              image: 'https://img/a',
            },
            { title: 'No link' },
            { title: 3, link: 'https://example.com/b' },
          ],
        },
        'Tech'
      )
    ).toEqual([
      {
        id: 'https://www.example.com/a',
        title: 'Chips',
        link: 'https://www.example.com/a',
        source: 'example.com',
        publishedAt: 5,
        topic: 'Tech',
        image: 'https://img/a',
      },
    ]);
  });
});

describe('isFeedStale', () => {
  test('a feed pulled on an earlier day is stale even if under a day old', () => {
    const evening = new Date(2026, 10, 23, 22).getTime();
    const morning = new Date(2026, 10, 24, 7).getTime();
    expect(isFeedStale(evening, morning)).toBe(true);
    expect(isFeedStale(morning, morning + 3600_000)).toBe(false);
  });
});

describe('uniqueTopics', () => {
  test('trims, drops empties and de-duplicates case-insensitively', () => {
    expect(uniqueTopics([' Science ', '', 'science', 'Robotics'])).toEqual([
      'Science',
      'Robotics',
    ]);
  });
});

describe('topicOptions', () => {
  test('lists the selection, then known topics, then suggestions', () => {
    expect(
      topicOptions(
        ['Robotics'],
        { known: ['Sailing', 'robotics'], hidden: [], colors: {} },
        ['Science', 'Sailing']
      )
    ).toEqual(['Robotics', 'Sailing', 'Science']);
  });

  test('leaves out suggestions the user deleted', () => {
    expect(
      topicOptions([], { known: [], hidden: ['science'], colors: {} }, [
        'Science',
        'Music',
      ])
    ).toEqual(['Music']);
  });
});

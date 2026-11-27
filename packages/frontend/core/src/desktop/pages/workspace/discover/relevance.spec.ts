import { describe, expect, test } from 'vitest';

import type { DiscoverItem } from './feed';
import { NO_EDITS, type UserInterests } from './interests';
import {
  type Dismissal,
  dismissalOf,
  interestsToDrop,
  mergeDismissals,
  rankFeed,
  titleSimilarity,
  TOPIC_DISMISSALS,
  whyShown,
} from './relevance';

const NOW = Date.UTC(2026, 10, 26, 23, 0);

const item = (id: string, title: string, topic = 'Robotics'): DiscoverItem => ({
  id,
  title,
  link: `https://news/${id}`,
  source: 'The Verge',
  topic,
});

const dismissal = (
  title: string,
  topic = 'Robotics',
  at = NOW - 60_000,
  id = title
): Dismissal => ({ id, title, topic, source: 'X', at });

describe('stories like a dismissed one', () => {
  test('titles are compared by the words they share', () => {
    expect(
      titleSimilarity(
        'Rams beat Packers in overtime thriller',
        'Packers lose to Rams in overtime thriller'
      )
    ).toBeGreaterThanOrEqual(0.5);
    expect(
      titleSimilarity('Rams beat Packers', 'New humanoid robot walks')
    ).toBe(0);
  });

  test('the dismissed story and the same story elsewhere are left out; like ones sink', () => {
    const ranked = rankFeed(
      [
        item('rams', 'Rams beat Packers in overtime thriller', 'Journal'),
        item('rams-2', 'Packers lose to Rams in overtime thriller', 'Journal'),
        item('packers-coach', 'Packers coach on the overtime loss', 'Journal'),
        item('robot', 'New humanoid robot walks across the lab'),
      ],
      [
        dismissal(
          'Rams beat Packers in overtime thriller',
          'Journal',
          NOW,
          'rams'
        ),
      ],
      NOW
    );
    expect(ranked.items.map(i => i.id)).toEqual(['robot', 'packers-coach']);
    expect(ranked.hidden).toBe(2);
    expect(ranked.lowered.get('packers-coach')).toEqual({
      kind: 'like',
      title: 'Rams beat Packers in overtime thriller',
    });
  });

  test(`a topic dismissed ${TOPIC_DISMISSALS} times lately sinks; older dismissals don't count`, () => {
    const stories = [
      item('j1', 'Mining output rises in Michigan', 'Journal'),
      item('r1', 'A robot arm that sorts parcels'),
    ];
    const recent = Array.from({ length: TOPIC_DISMISSALS }, (_, i) =>
      dismissal(`unrelated story ${'abcdefg'[i]} words`, 'Journal')
    );
    expect(rankFeed(stories, recent, NOW).items.map(i => i.id)).toEqual([
      'r1',
      'j1',
    ]);
    const old = recent.map(d => ({ ...d, at: NOW - 40 * 86_400_000 }));
    expect(rankFeed(stories, old, NOW).items.map(i => i.id)).toEqual([
      'j1',
      'r1',
    ]);
  });

  test('an interest with many dismissed stories is offered for removal', () => {
    const many = Array.from({ length: 4 }, (_, i) =>
      dismissal(`journal story ${'abcd'[i]}`, 'Journal')
    );
    expect(interestsToDrop(many, ['Journal', 'Robotics'], NOW)).toEqual([
      { topic: 'Journal', count: 4 },
    ]);
  });

  test('lists from two devices merge: one per story, the latest, oldest first', () => {
    const a = dismissal('one', 'T', 1, 'x');
    const b = dismissal('two', 'T', 5, 'y');
    const a2 = { ...a, at: 9 };
    expect(mergeDismissals([a, b], [a2]).map(d => [d.id, d.at])).toEqual([
      ['y', 5],
      ['x', 9],
    ]);
    expect(dismissalOf(item('z', 'Zed'), 3)).toMatchObject({ id: 'z', at: 3 });
  });
});

describe('why a story is in the feed', () => {
  const interests: UserInterests = {
    specific: [
      { label: 'Journal', weight: 80, notes: 42, tag: true },
      { label: 'Can Bus', weight: 6, notes: 3, tag: false },
    ],
    general: [{ label: 'Robotics', weight: 20, from: ['Can Bus', 'Lidar'] }],
    discover: ['Space'],
    discoverNear: { Space: 'Robotics' },
    computedAt: NOW,
  };
  const sources = { manualTopics: ['Technology'], interests, edits: NO_EDITS };
  const first = (topic: string, origin?: 'record') =>
    whyShown({ ...item('i', 't', topic), origin }, sources)[0];

  test('names where its topic came from', () => {
    expect(first('Technology')).toBe(
      'It\'s news on "Technology", a topic you picked.'
    );
    expect(first('Journal')).toBe(
      'It\'s news on "Journal": 42 notes of yours have that tag.'
    );
    expect(first('Can Bus')).toBe(
      'It\'s news on "Can Bus": the words come up in 3 note titles of yours.'
    );
    expect(first('Robotics')).toBe(
      'It\'s news on Robotics, a broad area your interests "Can Bus", "Lidar" belong to.'
    );
    expect(first('Space')).toBe(
      'Something new: Space sits next to Robotics, which your notes cover.'
    );
    expect(first('Email', 'record')).toBe("It's new in your Email folder.");
    expect(
      whyShown(item('i', 't', 'Lidar'), {
        ...sources,
        edits: { removed: [], added: ['Lidar'] },
      })[0]
    ).toBe('It\'s news on "Lidar", an interest you added.');
  });

  test('says where it was published, and why it was moved lower', () => {
    const reasons = whyShown(item('i', 't', 'Journal'), sources, {
      kind: 'topic',
      topic: 'Journal',
      count: 4,
    });
    expect(reasons[1]).toBe('The Verge published it, via Google News.');
    expect(reasons[2]).toBe(
      'It\'s lower in the list: you marked 4 stories on "Journal" not interesting lately.'
    );
  });
});

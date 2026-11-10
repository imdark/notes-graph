import { describe, expect, test } from 'vitest';

import { topicOptions, uniqueTopics } from './feed';

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
      topicOptions(
        [],
        { known: [], hidden: ['science'], colors: {} },
        ['Science', 'Music']
      )
    ).toEqual(['Music']);
  });
});

import { describe, expect, test } from 'vitest';

import {
  addInterest,
  deriveInterests,
  interestSearchTopics,
  NO_EDITS,
  removeInterest,
} from './interests';

const NOW = Date.UTC(2026, 9, 18);
const DAY = 24 * 60 * 60 * 1000;

const doc = (title: string, tagIds: string[] = [], ageDays = 90) => ({
  id: title,
  title,
  tagIds,
  updatedDate: NOW - ageDays * DAY,
});

describe('deriveInterests', () => {
  test('picks tags and phrases that recur across titles', () => {
    const interests = deriveInterests({
      now: NOW,
      tagNames: new Map([['t1', 'teleop']]),
      docs: [
        doc('reComputer CAN bus setup', ['t1']),
        doc('CAN bus termination notes'),
        doc('Weekend trip'),
      ],
    });
    const labels = interests.specific.map(i => i.label);
    expect(labels).toContain('teleop');
    expect(labels).toContain('Can Bus');
    // the bare word gives way to the phrase containing it
    expect(labels).not.toContain('Can');
    // one-off title words are not interests
    expect(labels).not.toContain('Trip');
  });

  test('maps specifics to general areas and offers adjacent ones', () => {
    const interests = deriveInterests({
      now: NOW,
      tagNames: new Map([
        ['t1', 'robotics'],
        ['t2', 'jetson'],
      ]),
      docs: [doc('a', ['t1', 't2']), doc('b', ['t2'])],
    });
    expect(interests.general[0].label).toBe('Robotics');
    expect(interests.discover).toContain('Embedded systems');
    expect(interests.discover).not.toContain('Robotics');
  });

  test('recent notes weigh more', () => {
    const interests = deriveInterests({
      now: NOW,
      tagNames: new Map([
        ['old', 'gardening'],
        ['new', 'pottery'],
      ]),
      docs: [doc('x', ['old'], 200), doc('y', ['new'], 1)],
    });
    expect(interests.specific[0].label).toBe('pottery');
  });

  test('ignores journal-style and stopword titles', () => {
    const interests = deriveInterests({
      now: NOW,
      tagNames: new Map(),
      docs: [
        doc('2026-10-17'),
        doc('2026-10-18'),
        doc('Untitled'),
        doc('Untitled'),
      ],
    });
    expect(interests.specific).toEqual([]);
  });
});

describe('interestSearchTopics', () => {
  test('mixes specific, general and discovery topics without repeating manual ones', () => {
    const topics = interestSearchTopics(
      {
        specific: [
          { label: 'teleop', weight: 4 },
          { label: 'Robotics', weight: 2 },
        ],
        general: [{ label: 'Robotics', weight: 6 }],
        discover: ['Embedded systems'],
        computedAt: NOW,
      },
      ['TELEOP']
    );
    expect(topics).toEqual(['Robotics', 'Embedded systems']);
  });

  test('puts added interests first and lets the next one fill a removed slot', () => {
    const specific = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(label => ({
      label,
      weight: 1,
    }));
    const topics = interestSearchTopics(
      { specific, general: [], discover: ['Music'], computedAt: NOW },
      [],
      { added: ['Sailing'], removed: ['b', 'Music'] }
    );
    expect(topics).toEqual(['Sailing', 'A', 'C', 'D', 'E', 'F', 'G']);
  });

  test('searches added interests before any have been read from the notes', () => {
    expect(
      interestSearchTopics(null, [], { added: ['Sailing'], removed: [] })
    ).toEqual(['Sailing']);
  });
});

describe('interest edits', () => {
  test('removing an added interest forgets it instead of hiding it', () => {
    const added = addInterest(NO_EDITS, '  sailing   boats ');
    expect(added).toEqual({ added: ['sailing boats'], removed: [] });
    expect(removeInterest(added, 'Sailing Boats')).toEqual(NO_EDITS);
  });

  test('adding a removed interest brings it back', () => {
    const removed = removeInterest(NO_EDITS, 'Robotics');
    expect(removed).toEqual({ added: [], removed: ['Robotics'] });
    expect(addInterest(removed, 'robotics')).toEqual(NO_EDITS);
  });

  test('ignores blanks and duplicates', () => {
    const once = addInterest(NO_EDITS, 'Sailing');
    expect(addInterest(once, 'SAILING')).toBe(once);
    expect(addInterest(once, '   ')).toBe(once);
    expect(removeInterest(removeInterest(NO_EDITS, 'X'), 'x')).toEqual({
      added: [],
      removed: ['X'],
    });
  });
});

import { describe, expect, test } from 'vitest';

import { splitDictatedTasks } from '../utils/split-tasks';

describe('splitDictatedTasks', () => {
  test('one task per utterance line', () => {
    expect(
      splitDictatedTasks('buy milk\ncall the dentist\n\n  water plants ')
    ).toEqual(['Buy milk', 'Call the dentist', 'Water plants']);
  });

  test('splits on spoken separators', () => {
    expect(
      splitDictatedTasks(
        'buy milk next task call the dentist new item water plants Another to-do pay rent'
      )
    ).toEqual(['Buy milk', 'Call the dentist', 'Water plants', 'Pay rent']);
  });

  test('leaves a bare "next" inside a task alone', () => {
    expect(splitDictatedTasks('plan next week')).toEqual(['Plan next week']);
  });

  test('splits punctuated sentences and drops trailing punctuation', () => {
    expect(
      splitDictatedTasks('Buy milk. Call mom! Is the car booked?')
    ).toEqual(['Buy milk', 'Call mom!', 'Is the car booked?']);
  });

  test('drops lead-in filler but not words that start with it', () => {
    expect(
      splitDictatedTasks('and then email Sam\nalso book flights\nAndrew review')
    ).toEqual(['Email Sam', 'Book flights', 'Andrew review']);
  });

  test('nothing said, nothing to add', () => {
    expect(splitDictatedTasks('')).toEqual([]);
    expect(splitDictatedTasks(' next task \n and ')).toEqual([]);
  });
});

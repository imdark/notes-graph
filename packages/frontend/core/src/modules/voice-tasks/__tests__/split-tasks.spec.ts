import { describe, expect, test } from 'vitest';

import { appendDictation, splitDictatedTasks } from '../utils/split-tasks';

/** What the sheet ends up with after hearing these utterances in turn. */
const dictate = (...utterances: string[]) =>
  utterances.reduce(appendDictation, '');

describe('splitDictatedTasks', () => {
  test('one task per line', () => {
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

  test('keeps punctuated sentences in one task, minus trailing punctuation', () => {
    expect(
      splitDictatedTasks('Buy milk. Get the full fat kind.\nIs the car booked?')
    ).toEqual(['Buy milk. Get the full fat kind', 'Is the car booked?']);
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

describe('appendDictation', () => {
  test('a pause does not start a new task', () => {
    const transcript = dictate('buy milk', 'and the eggs', 'from the market');
    expect(transcript).toBe('buy milk and the eggs from the market');
    expect(splitDictatedTasks(transcript)).toEqual([
      'Buy milk and the eggs from the market',
    ]);
  });

  test('"next task" starts a new line', () => {
    const transcript = dictate(
      'buy milk next task call',
      'the dentist',
      'next task',
      'water plants'
    );
    expect(transcript).toBe('buy milk\ncall the dentist\nwater plants');
  });

  test('"next task" split across a pause still counts', () => {
    expect(dictate('buy milk next', 'task call mom')).toBe(
      'buy milk\ncall mom'
    );
  });

  test('drops the period a recognizer puts at each pause', () => {
    expect(dictate('Buy milk.', 'And eggs.', 'Next task.', 'Call mom.')).toBe(
      'Buy milk And eggs\nCall mom'
    );
  });

  test('carries on from what the speaker typed', () => {
    expect(appendDictation('buy milk\n', 'call mom')).toBe('buy milk\ncall mom');
    expect(appendDictation('buy milk  ', 'and eggs')).toBe('buy milk and eggs');
    expect(appendDictation('buy milk', '  ')).toBe('buy milk');
  });

  test('a leading "next task" leaves no empty line', () => {
    expect(dictate('next task', 'buy milk')).toBe('buy milk');
  });
});

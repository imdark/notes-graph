import { describe, expect, test } from 'vitest';

import { appendDictation, splitDictatedTasks } from '../utils/split-tasks';

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

  test('punctuation does not end a task; trailing marks go', () => {
    expect(
      splitDictatedTasks('Book the car. The blue one, for Friday.')
    ).toEqual(['Book the car. The blue one, for Friday']);
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
  const dictate = (...utterances: string[]) =>
    utterances.reduce(appendDictation, '');

  test('a pause continues the same task', () => {
    const text = dictate('call the dentist', 'about the', 'cleaning Friday');
    expect(text).toBe('call the dentist about the cleaning Friday');
    expect(splitDictatedTasks(text)).toEqual([
      'Call the dentist about the cleaning Friday',
    ]);
  });

  test('"next task" becomes a line break', () => {
    expect(dictate('buy milk next task call mom')).toBe('buy milk\ncall mom');
  });

  test('a separator ending one utterance starts the next on a new line', () => {
    expect(dictate('buy milk next task', 'call mom')).toBe(
      'buy milk\ncall mom'
    );
  });

  test('a separator split across two utterances still counts', () => {
    expect(dictate('buy milk next', 'task call mom')).toBe(
      'buy milk\ncall mom'
    );
  });

  test('keeps lines the user typed, and ignores empty utterances', () => {
    expect(appendDictation('water plants\n', '  ')).toBe('water plants\n');
    expect(appendDictation('water plants\n', 'pay rent')).toBe(
      'water plants\npay rent'
    );
  });

  test('a lone separator at the start adds nothing', () => {
    expect(dictate('next task', 'buy milk')).toBe('buy milk');
  });
});

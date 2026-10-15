import { describe, expect, test } from 'vitest';

import { savedAnswer } from './saved-answer';

const doc = (docId: string) => JSON.stringify({ type: 'doc', docId });

describe('savedAnswer', () => {
  test('takes the first heading as the title', () => {
    const answer = savedAnswer(
      [
        'Here is what I found.',
        '',
        '## **Cosmo**’s school options[^1]',
        'Text',
      ].join('\n')
    );
    expect(answer.title).toBe('Cosmo’s school options');
  });

  test('falls back to the first line, without list or link markup', () => {
    expect(
      savedAnswer('- See [the plan](https://x.y) for details\n- more').title
    ).toBe('See the plan for details');
  });

  test('shortens a long first line at a word', () => {
    const title = savedAnswer(`${'word '.repeat(30)}end`).title;
    expect(title.length).toBeLessThanOrEqual(81);
    expect(title.endsWith('word…')).toBe(true);
  });

  test('collects cited notes once each, in order, and skips other citations', () => {
    const answer = savedAnswer(
      [
        'Answer[^1][^2][^3]',
        '',
        `[^1]: ${doc('b')}`,
        `[^2]: {"type":"url","url":"https%3A%2F%2Fexample.com"}`,
        `[^3]: ${doc('a')}`,
        `[^4]: ${doc('b')}`,
        '[^5]: {not json}',
      ].join('\n')
    );
    expect(answer.docIds).toEqual(['b', 'a']);
    expect(answer.title).toBe('Answer');
  });

  test('a footnote definition is never the title', () => {
    expect(savedAnswer(`[^1]: ${doc('a')}\nThe answer`).title).toBe(
      'The answer'
    );
  });

  test('an empty answer has an empty title and no links', () => {
    expect(savedAnswer('')).toEqual({ title: '', docIds: [] });
  });
});

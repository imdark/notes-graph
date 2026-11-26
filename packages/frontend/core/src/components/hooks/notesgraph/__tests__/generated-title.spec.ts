import { describe, expect, test } from 'vitest';

import { cleanGeneratedTitle } from '../generated-title';

describe('cleanGeneratedTitle', () => {
  test('keeps a plain title', () => {
    expect(cleanGeneratedTitle('Trip to Lisbon in May')).toBe(
      'Trip to Lisbon in May'
    );
  });

  test('drops quotes, a heading mark, a label and a closing period', () => {
    expect(cleanGeneratedTitle('"Trip to Lisbon"')).toBe('Trip to Lisbon');
    expect(cleanGeneratedTitle('“Trip to Lisbon”')).toBe('Trip to Lisbon');
    expect(cleanGeneratedTitle('# Trip to Lisbon')).toBe('Trip to Lisbon');
    expect(cleanGeneratedTitle('**Trip to Lisbon**')).toBe('Trip to Lisbon');
    expect(cleanGeneratedTitle('Title: Trip to Lisbon.')).toBe(
      'Trip to Lisbon'
    );
  });

  test('takes the first line and ignores what follows', () => {
    expect(
      cleanGeneratedTitle('\n\nTrip to Lisbon\n\nThis title captures the plan.')
    ).toBe('Trip to Lisbon');
  });

  test('clips a long reply', () => {
    const title = cleanGeneratedTitle('word '.repeat(40));
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith('…')).toBe(true);
  });

  test('gives nothing for an empty reply', () => {
    expect(cleanGeneratedTitle('  \n ')).toBe('');
  });
});

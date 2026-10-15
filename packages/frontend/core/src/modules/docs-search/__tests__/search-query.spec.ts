import { describe, expect, test } from 'vitest';

import {
  dateFilterRange,
  hasScopeFilters,
  hasSearchFilters,
  matchesDateFilters,
  matchesWordFilters,
  parseSearchQuery,
  searchText,
} from '../utils/search-query';

const day = (date: string) => Date.parse(`${date}T00:00:00.000Z`);

describe('parseSearchQuery', () => {
  test('a plain query has no filters', () => {
    const filters = parseSearchQuery('  how do  we deploy  ');
    expect(filters.text).toBe('how do we deploy');
    expect(hasSearchFilters(filters)).toBe(false);
  });

  test('pulls every filter out of the query', () => {
    const filters = parseSearchQuery(
      'deploy steps tag:Work prop:status:Done doc:"Weekly notes" doc:abc123 dt>=2026-01-01 ct<2026-02-01 +"fly.io" -staging'
    );
    expect(filters).toEqual({
      text: 'deploy steps',
      tags: ['work'],
      props: ['status:done'],
      docs: ['Weekly notes', 'abc123'],
      dates: [
        { field: 'updated', op: '>=', date: '2026-01-01' },
        { field: 'created', op: '<', date: '2026-02-01' },
      ],
      include: ['fly.io'],
      exclude: ['staging'],
    });
    expect(hasScopeFilters(filters)).toBe(true);
  });

  test('quoted values keep their spaces', () => {
    const filters = parseSearchQuery('tag:"two words" +"exact phrase here"');
    expect(filters.tags).toEqual(['two words']);
    expect(filters.include).toEqual(['exact phrase here']);
    expect(filters.text).toBe('');
  });

  test('a quoted phrase without a filter prefix stays search text', () => {
    expect(parseSearchQuery('"release notes" 2026').text).toBe(
      '"release notes" 2026'
    );
  });

  test('malformed filters stay search text', () => {
    const query = 'tag: prop:novalue dt>=2026-02-31 dt>=yesterday - + c++';
    const filters = parseSearchQuery(query);
    expect(filters.text).toBe(query);
    expect(hasSearchFilters(filters)).toBe(false);
  });

  test('word-only filters are not scope filters', () => {
    const filters = parseSearchQuery('-draft +"q3"');
    expect(hasSearchFilters(filters)).toBe(true);
    expect(hasScopeFilters(filters)).toBe(false);
    expect(searchText(filters)).toBe('q3');
  });
});

describe('date filters', () => {
  const range = (q: string) =>
    dateFilterRange(parseSearchQuery(q).dates, 'updated');

  test('operators map to half-open whole-day ranges', () => {
    expect(range('dt>=2026-03-10')).toEqual({ from: day('2026-03-10') });
    expect(range('dt>2026-03-10')).toEqual({ from: day('2026-03-11') });
    expect(range('dt<=2026-03-10')).toEqual({ to: day('2026-03-11') });
    expect(range('dt<2026-03-10')).toEqual({ to: day('2026-03-10') });
    expect(range('dt=2026-03-10')).toEqual({
      from: day('2026-03-10'),
      to: day('2026-03-11'),
    });
    expect(range('dt>=2026-01-01 dt>=2026-02-01 dt<2026-06-01')).toEqual({
      from: day('2026-02-01'),
      to: day('2026-06-01'),
    });
    expect(range('ct>=2026-01-01')).toBeUndefined();
  });

  test('matchesDateFilters checks each field and fails missing dates', () => {
    const { dates } = parseSearchQuery('dt>=2026-03-01 ct<2026-01-01');
    expect(
      matchesDateFilters(dates, {
        updatedAt: day('2026-03-01'),
        createdAt: day('2025-12-31'),
      })
    ).toBe(true);
    expect(
      matchesDateFilters(dates, {
        updatedAt: day('2026-02-28'),
        createdAt: day('2025-12-31'),
      })
    ).toBe(false);
    expect(matchesDateFilters(dates, { updatedAt: day('2026-03-02') })).toBe(
      false
    );
    expect(matchesDateFilters([], {})).toBe(true);
  });
});

test('matchesWordFilters is case-insensitive', () => {
  const filters = parseSearchQuery('+Deploy -"Staging env"');
  expect(matchesWordFilters(filters, 'how we deploy to prod')).toBe(true);
  expect(matchesWordFilters(filters, 'how we deploy to the staging env')).toBe(
    false
  );
  expect(matchesWordFilters(filters, 'nothing relevant')).toBe(false);
});

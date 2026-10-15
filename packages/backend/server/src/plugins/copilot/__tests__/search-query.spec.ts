import test from 'ava';

import {
  dateFilterRange,
  hasScopeFilters,
  hasSearchFilters,
  matchesDateFilters,
  matchesWordFilters,
  parseSearchQuery,
  searchText,
} from '../search-query';

const day = (date: string) => Date.parse(`${date}T00:00:00.000Z`);

test('a plain query has no filters', t => {
  const filters = parseSearchQuery('  how do  we deploy  ');
  t.is(filters.text, 'how do we deploy');
  t.false(hasSearchFilters(filters));
});

test('pulls every filter out of the query', t => {
  const filters = parseSearchQuery(
    'deploy steps tag:Work prop:status:Done doc:"Weekly notes" doc:abc123 dt>=2026-01-01 ct<2026-02-01 +"fly.io" -staging'
  );
  t.is(filters.text, 'deploy steps');
  t.deepEqual(filters.tags, ['work']);
  t.deepEqual(filters.props, ['status:done']);
  t.deepEqual(filters.docs, ['Weekly notes', 'abc123']);
  t.deepEqual(filters.dates, [
    { field: 'updated', op: '>=', date: '2026-01-01' },
    { field: 'created', op: '<', date: '2026-02-01' },
  ]);
  t.deepEqual(filters.include, ['fly.io']);
  t.deepEqual(filters.exclude, ['staging']);
  t.true(hasScopeFilters(filters));
});

test('quoted values keep their spaces', t => {
  const filters = parseSearchQuery('tag:"two words" +"exact phrase here"');
  t.deepEqual(filters.tags, ['two words']);
  t.deepEqual(filters.include, ['exact phrase here']);
  t.is(filters.text, '');
});

test('a quoted phrase without a filter prefix stays search text', t => {
  t.is(parseSearchQuery('"release notes" 2026').text, '"release notes" 2026');
});

test('malformed filters stay search text', t => {
  const filters = parseSearchQuery(
    'tag: prop:novalue dt>=2026-02-31 dt>=yesterday - + c++'
  );
  t.is(filters.text, 'tag: prop:novalue dt>=2026-02-31 dt>=yesterday - + c++');
  t.false(hasSearchFilters(filters));
});

test('word-only filters are not scope filters', t => {
  const filters = parseSearchQuery('-draft +"q3"');
  t.true(hasSearchFilters(filters));
  t.false(hasScopeFilters(filters));
  t.is(searchText(filters), 'q3', 'falls back to must-contain words');
});

test('date operators map to half-open whole-day ranges', t => {
  const range = (q: string) =>
    dateFilterRange(parseSearchQuery(q).dates, 'updated');
  t.deepEqual(range('dt>=2026-03-10'), { from: day('2026-03-10') });
  t.deepEqual(range('dt>2026-03-10'), { from: day('2026-03-11') });
  t.deepEqual(range('dt<=2026-03-10'), { to: day('2026-03-11') });
  t.deepEqual(range('dt<2026-03-10'), { to: day('2026-03-10') });
  t.deepEqual(range('dt=2026-03-10'), {
    from: day('2026-03-10'),
    to: day('2026-03-11'),
  });
  t.deepEqual(range('dt>=2026-01-01 dt>=2026-02-01 dt<2026-06-01'), {
    from: day('2026-02-01'),
    to: day('2026-06-01'),
  });
  t.is(range('ct>=2026-01-01'), undefined, 'created filters only');
});

test('matchesDateFilters checks each field and fails missing dates', t => {
  const { dates } = parseSearchQuery('dt>=2026-03-01 ct<2026-01-01');
  t.true(
    matchesDateFilters(dates, {
      updatedAt: day('2026-03-01'),
      createdAt: day('2025-12-31'),
    })
  );
  t.false(
    matchesDateFilters(dates, {
      updatedAt: day('2026-02-28'),
      createdAt: day('2025-12-31'),
    })
  );
  t.false(matchesDateFilters(dates, { updatedAt: day('2026-03-02') }));
  t.true(matchesDateFilters([], {}));
});

test('matchesWordFilters is case-insensitive', t => {
  const filters = parseSearchQuery('+Deploy -"Staging env"');
  t.true(matchesWordFilters(filters, 'how we deploy to prod'));
  t.false(matchesWordFilters(filters, 'how we deploy to the staging env'));
  t.false(matchesWordFilters(filters, 'nothing relevant'));
});

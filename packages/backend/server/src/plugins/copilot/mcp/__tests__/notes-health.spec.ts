import test from 'ava';

import { asOfDate, notesHealth, titleKey } from '../notes-health';

/** What the notes_health tool works out from the search index. */

const now = new Date('2026-10-14T12:00:00Z');
const body = 'x'.repeat(200);

const doc = (
  docId: string,
  title: string,
  summary = body,
  journal = false
) => ({
  docId,
  title,
  summary,
  journal,
});

test('a note nothing else links to is an orphan; a journal day never is', t => {
  const report = notesHealth(
    {
      docs: [
        doc('hub', 'Hub'),
        doc('a', 'A'),
        doc('b', 'B'),
        doc('j', '2026-10-14', body, true),
      ],
      links: [
        { fromDocId: 'hub', toDocId: 'a' },
        // Linking to itself doesn't make a note reachable.
        { fromDocId: 'b', toDocId: 'b' },
      ],
      blocks: [],
    },
    { now }
  );
  t.deepEqual(
    report.orphans.map(o => o.docId),
    ['hub', 'b']
  );
});

test('a link to a note that is not in the index is broken, once per pair', t => {
  const report = notesHealth(
    {
      docs: [doc('a', 'Trip plan'), doc('b', 'B')],
      links: [
        { fromDocId: 'a', toDocId: 'gone' },
        { fromDocId: 'a', toDocId: 'gone' },
        { fromDocId: 'a', toDocId: 'b' },
      ],
      blocks: [],
    },
    { now }
  );
  t.deepEqual(report.brokenLinks, [
    { fromDocId: 'a', fromTitle: 'Trip plan', toDocId: 'gone' },
  ]);
});

test('titles with the same words are grouped as possible duplicates', t => {
  t.is(titleKey('Cosmo: notes'), titleKey('Notes on cosmo'));
  t.is(titleKey('Café plans'), titleKey('cafe PLANS'));
  t.is(titleKey('Untitled'), '');

  const report = notesHealth(
    {
      docs: [
        doc('1', 'Cosmo notes'),
        doc('2', 'notes, Cosmo'),
        doc('3', 'Cosmo'),
        doc('4', 'Untitled'),
        doc('5', 'Untitled'),
      ],
      links: [],
      blocks: [],
    },
    { now }
  );
  t.is(report.duplicateTitles.length, 1);
  t.deepEqual(
    report.duplicateTitles[0].docs.map(d => d.docId),
    ['1', '2']
  );
});

test('a note with almost no body is a stub', t => {
  const report = notesHealth(
    {
      docs: [
        doc('a', 'Draft', '  todo  '),
        doc('b', 'Full'),
        doc('j', 'day', '', true),
      ],
      links: [],
      blocks: [],
    },
    { now, stubChars: 50 }
  );
  t.deepEqual(report.stubs, [{ docId: 'a', title: 'Draft', chars: 4 }]);
});

test('"as of" dates are read as the agents write them', t => {
  t.is(
    asOfDate("Cosmo: the user's son, 7 years old (as of 2026-10-02).")?.asOf,
    '2026-10-02'
  );
  t.is(asOfDate('Rent is $2,000 as of 2025-03')?.asOf, '2025-03');
  t.is(asOfDate('as of next week'), null);
  t.is(asOfDate('as of 2026-13-01'), null);
});

test('a fact stamped longer ago than staleDays is stale, oldest first', t => {
  const report = notesHealth(
    {
      docs: [doc('cosmo', 'Cosmo')],
      links: [],
      blocks: [
        {
          docId: 'cosmo',
          blockId: 'b1',
          text: '7 years old (as of 2026-09-01)',
        },
        {
          docId: 'cosmo',
          blockId: 'b2',
          text: 'Likes Lego (as of 2025-10-01)',
        },
        {
          docId: 'cosmo',
          blockId: 'b3',
          text: 'School: Elm St (as of 2024-01)',
        },
        { docId: 'missing', blockId: 'b4', text: 'as of 2020-01-01' },
        { docId: 'cosmo', blockId: 'b5', text: 'nothing dated here' },
      ],
    },
    { now, staleDays: 180 }
  );
  t.deepEqual(
    report.staleFacts.map(f => [f.blockId, f.asOf]),
    [
      ['b3', '2024-01'],
      ['b2', '2025-10-01'],
    ]
  );
  t.is(report.staleFacts[1].ageDays, 378);
});

import test from 'ava';

import { JOURNAL_DATE_RE, journalScaffold, todayDate } from '../journal';

/** The outline ensure_journal gives a day it creates. */

test('a section per project, each with an empty to-do, then Inbox', t => {
  t.is(
    journalScaffold(['Work', 'notes graph']),
    '## Work\n\n- [ ] \n\n## notes graph\n\n- [ ] \n\n## Inbox\n\n- [ ] \n'
  );
});

test('no projects still gets the Inbox section', t => {
  t.is(journalScaffold([]), '## Inbox\n\n- [ ] \n');
});

test('blank names and a project called Inbox are not repeated', t => {
  t.is(
    journalScaffold([' ', 'inbox', 'Work ']),
    '## Work\n\n- [ ] \n\n## Inbox\n\n- [ ] \n'
  );
});

test('dates are YYYY-MM-DD, today in UTC', t => {
  t.is(todayDate(new Date('2026-11-17T23:30:00Z')), '2026-11-17');
  t.true(JOURNAL_DATE_RE.test('2026-11-17'));
  t.false(JOURNAL_DATE_RE.test('2026-11-17T00:00'));
});

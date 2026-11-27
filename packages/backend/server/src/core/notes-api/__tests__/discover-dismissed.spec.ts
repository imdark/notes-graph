import test from 'ava';

import { discoverDismissed, MAX_DISCOVER_DISMISSED } from '../controller';

/** What the server keeps of the stories a user marked not interesting. */

const story = (id: string, at: number) => ({
  id,
  title: `Story ${id}`,
  topic: 'Robotics',
  source: 'The Verge',
  at,
});

test('keeps one entry per story, the latest, oldest first', t => {
  const saved = discoverDismissed([
    story('b', 2),
    story('a', 1),
    { ...story('b', 3), title: 'Story b, again' },
  ]);
  t.deepEqual(
    saved.map(s => [s.id, s.at]),
    [
      ['a', 1],
      ['b', 3],
    ]
  );
  t.is(saved[1].title, 'Story b, again');
});

test('drops malformed entries and clips long text', t => {
  const saved = discoverDismissed([
    null,
    'nope',
    { id: '', at: 1 },
    { id: 'x', at: 'later' },
    { id: 'ok', at: 5, title: 't'.repeat(900), topic: 7 },
  ]);
  t.is(saved.length, 1);
  t.is(saved[0].title.length, 500);
  t.is(saved[0].topic, '');
});

test('keeps only the newest when over the cap, and refuses a non-list', t => {
  const many = Array.from({ length: MAX_DISCOVER_DISMISSED + 20 }, (_, i) =>
    story(`s${i}`, i)
  );
  const saved = discoverDismissed(many);
  t.is(saved.length, MAX_DISCOVER_DISMISSED);
  t.is(saved[0].id, 's20');
  t.throws(() => discoverDismissed({ id: 'x' }));
});

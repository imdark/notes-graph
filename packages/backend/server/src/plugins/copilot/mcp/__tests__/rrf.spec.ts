import test from 'ava';

import { applyBudget, fuseRanked } from '../rrf';

test('a doc found by both lists outranks single-list leaders', t => {
  const fused = fuseRanked([
    { source: 'keyword', hits: [{ docId: 'a' }, { docId: 'b' }] },
    { source: 'semantic', hits: [{ docId: 'c' }, { docId: 'b' }] },
  ]);
  t.deepEqual(
    fused.map(h => h.docId),
    ['b', 'a', 'c']
  );
  t.deepEqual(fused[0].sources, ['keyword', 'semantic']);
});

test('duplicate docs inside one list count once', t => {
  const fused = fuseRanked([
    {
      source: 'semantic',
      hits: [{ docId: 'a' }, { docId: 'a' }, { docId: 'b' }],
    },
  ]);
  t.deepEqual(
    fused.map(h => h.docId),
    ['a', 'b']
  );
  t.is(fused[1].score, 1 / 62);
});

test('budget limits item count and characters', t => {
  const hits = fuseRanked([
    {
      source: 'semantic',
      hits: [
        { docId: 'a', text: 'x'.repeat(10) },
        { docId: 'b', text: 'y'.repeat(10) },
        { docId: 'c', text: 'z'.repeat(10) },
      ],
    },
  ]);
  t.is(applyBudget(hits, 2, 100).length, 2);
  const cut = applyBudget(hits, 10, 15);
  t.deepEqual(
    cut.map(h => h.text?.length),
    [10, 5]
  );
});

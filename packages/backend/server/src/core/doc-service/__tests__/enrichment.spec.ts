import test from 'ava';

import { enrichDoc, generateTitle } from '../enrichment';

test('keeps a note that has a title', t => {
  t.deepEqual(enrichDoc({ title: 'Plans', body: 'text' }), { action: 'keep' });
});

test('flags a note with no title and no body', t => {
  t.deepEqual(enrichDoc({ title: '  ', body: ' \n ' }), {
    action: 'flagEmpty',
  });
  t.deepEqual(enrichDoc({ title: null, body: '' }), { action: 'flagEmpty' });
});

test('titles an untitled note from its first sentence', t => {
  t.deepEqual(
    enrichDoc({ title: '', body: '- Buy milk. Then eggs.\nSecond line' }),
    { action: 'setTitle', title: 'Buy milk' }
  );
});

test('cuts a long first line at a word boundary', t => {
  const title = generateTitle('word '.repeat(40));
  t.true(title!.endsWith('…'));
  t.true(title!.length <= 61);
});

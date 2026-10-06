import test from 'ava';

import { splitChunkText } from '../types';

test('short text stays one chunk', t => {
  t.deepEqual(splitChunkText('hello world', 20), ['hello world']);
});

test('long text splits at line breaks, each piece within the limit', t => {
  const lines = Array.from({ length: 30 }, (_, i) => `link ${i} https://example.com/${i}`);
  const pieces = splitChunkText(lines.join('\n'), 100);

  t.true(pieces.length > 1);
  t.true(pieces.every(piece => piece.length <= 100));
  t.deepEqual(pieces.join('\n').split('\n'), lines, 'nothing lost, in order');
});

test('a line too long for one chunk splits at sentences, then words', t => {
  const line = 'First sentence here. Second one is a bit longer. ' + 'word '.repeat(40);
  const pieces = splitChunkText(line, 60);

  t.true(pieces.every(piece => piece.length <= 60));
  t.true(
    pieces[0].startsWith('First sentence here. Second one is a bit longer.'),
    'sentences stay whole'
  );
  t.is(pieces.join(' ').replace(/\s+/g, ' '), line.trim());
});

test('a word longer than the limit is cut', t => {
  const pieces = splitChunkText('x'.repeat(250), 100);
  t.deepEqual(
    pieces.map(piece => piece.length),
    [100, 100, 50]
  );
});

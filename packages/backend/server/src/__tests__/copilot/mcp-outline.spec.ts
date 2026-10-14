import test from 'ava';

import { buildOutline, readSection } from '../../plugins/copilot/mcp/outline';

const doc = [
  '# Title',
  'intro',
  '## A',
  'a body',
  '```',
  '# not a heading',
  '```',
  '### A1',
  'deep',
  '## B',
  'b body',
].join('\n');

test('buildOutline lists headings and skips fenced code', t => {
  const outline = buildOutline(doc);
  t.deepEqual(
    outline.map(h => [h.level, h.title, h.line]),
    [
      [1, 'Title', 1],
      [2, 'A', 3],
      [3, 'A1', 8],
      [2, 'B', 10],
    ]
  );
  t.is(outline[0].length, doc.length);
});

test('readSection includes sub-sections and stops at the next peer', t => {
  const a = readSection(doc, 1);
  t.true(a?.startsWith('## A'));
  t.true(a?.includes('### A1'));
  t.false(a?.includes('## B'));
  t.is(readSection(doc, 3), '## B\nb body');
  t.is(readSection(doc, 9), null);
});

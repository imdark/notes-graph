import test from 'ava';
import * as Y from 'yjs';

import { buildDocSummary } from '../blocksuite';

/** A page with one note holding the given blocks, as a doc snapshot. */
function docWith(children: Record<string, Record<string, unknown>>) {
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  const block = (id: string, flavour: string, props: Record<string, unknown>) => {
    const map = new Y.Map();
    map.set('sys:id', id);
    map.set('sys:flavour', flavour);
    map.set('sys:version', 1);
    for (const [key, value] of Object.entries(props)) map.set(key, value);
    blocks.set(id, map);
    return map;
  };
  const text = (s: string) => {
    const t = new Y.Text();
    t.insert(0, s);
    return t;
  };

  const page = block('page', 'notesgraph:page', { 'prop:title': text('Links') });
  const note = block('note', 'notesgraph:note', {});
  page.set('sys:children', Y.Array.from(['note']));
  note.set('sys:children', Y.Array.from(Object.keys(children)));
  for (const [id, { flavour, ...props }] of Object.entries(children)) {
    const child = block(id, flavour as string, {
      ...props,
      ...(typeof props['prop:text'] === 'string'
        ? { 'prop:text': text(props['prop:text']) }
        : {}),
    });
    child.set('sys:children', new Y.Array());
  }
  return Y.encodeStateAsUpdate(doc);
}

const linksNote = docWith({
  p1: { flavour: 'notesgraph:paragraph', 'prop:type': 'text', 'prop:text': 'Reading list' },
  b1: {
    flavour: 'notesgraph:bookmark',
    'prop:url': 'https://example.com/profiling',
    'prop:title': 'Profiling Node apps',
    'prop:description': 'Flame graphs and heap snapshots',
  },
  y1: {
    flavour: 'notesgraph:embed-youtube',
    'prop:url': 'https://youtube.com/watch?v=abc',
    'prop:title': 'A talk',
    'prop:description': null,
  },
});

test('full content reads a link block as its title, description and url', t => {
  const content = buildDocSummary('doc', linksNote, -1);

  t.is(content?.title, 'Links');
  t.is(
    content?.summary,
    'Reading list ' +
      'Profiling Node apps — Flame graphs and heap snapshots — https://example.com/profiling ' +
      'A talk — https://youtube.com/watch?v=abc'
  );
});

test('a preview leaves link blocks out', t => {
  t.is(buildDocSummary('doc', linksNote, 150)?.summary, 'Reading list');
});

test('a note of only links has full content, not an empty one', t => {
  const onlyLinks = docWith({
    b1: { flavour: 'notesgraph:bookmark', 'prop:url': 'https://example.com' },
  });

  t.is(buildDocSummary('doc', onlyLinks, -1)?.summary, 'https://example.com');
  t.is(buildDocSummary('doc', onlyLinks, 150)?.summary, '');
});

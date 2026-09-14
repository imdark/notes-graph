import test from 'ava';
import * as Y from 'yjs';

import { createDocWithMarkdown } from '../../../native';
import {
  appendLinkedDocReference,
  NoteBlockNotFoundError,
} from '../blocksuite-headless';

function paragraphTexts(blocks: Y.Map<unknown>) {
  const texts: string[] = [];
  blocks.forEach(block => {
    const yBlock = block as Y.Map<unknown>;
    if (yBlock.get('sys:flavour') === 'notesgraph:paragraph') {
      texts.push((yBlock.get('prop:text') as Y.Text).toString());
    }
  });
  return texts;
}

test('appendLinkedDocReference adds a reference paragraph without touching existing content', t => {
  const docId = 'parent-doc';
  const original = createDocWithMarkdown(
    'Parent Doc',
    'First paragraph.\n\nSecond paragraph.',
    docId
  );

  const beforeDoc = new Y.Doc();
  Y.applyUpdate(beforeDoc, original);
  const originalTexts = paragraphTexts(beforeDoc.getMap('blocks'));
  t.is(originalTexts.length, 2, 'sanity check on the synthesized input');

  const delta = appendLinkedDocReference(original, docId, 'child-doc');

  // Apply original + delta onto a fresh doc, exactly as pushDocUpdates'
  // consumers do (base snapshot, then each subsequent update in order).
  const merged = new Y.Doc();
  Y.applyUpdate(merged, original);
  Y.applyUpdate(merged, delta);
  const blocks = merged.getMap('blocks');

  const mergedTexts = paragraphTexts(blocks);
  t.is(mergedTexts.length, 3, 'original two paragraphs plus the new reference one');
  for (const text of originalTexts) {
    t.true(mergedTexts.includes(text), `original paragraph preserved: "${text}"`);
  }

  let noteId: string | undefined;
  let refBlockId: string | undefined;
  blocks.forEach((block, id) => {
    const yBlock = block as Y.Map<unknown>;
    const flavour = yBlock.get('sys:flavour');
    if (flavour === 'notesgraph:note') noteId = id;
    if (flavour === 'notesgraph:paragraph') {
      const text = yBlock.get('prop:text') as Y.Text;
      if (text.toDelta().some((op: any) => op.attributes?.reference)) {
        refBlockId = id;
      }
    }
  });
  t.truthy(noteId, 'note block exists');
  t.truthy(refBlockId, 'a paragraph with a reference attribute was created');

  const refBlock = blocks.get(refBlockId!) as Y.Map<unknown>;
  const refDelta = (refBlock.get('prop:text') as Y.Text).toDelta();
  const refOp = refDelta.find((op: any) => op.attributes?.reference) as any;
  t.is(refOp.attributes.reference.type, 'LinkedPage');
  t.is(refOp.attributes.reference.pageId, 'child-doc');

  // The new block must be a child of the note (that's what makes it a real
  // in-doc reference, not a floating orphan block).
  const noteBlock = blocks.get(noteId!) as Y.Map<unknown>;
  const noteChildren = (
    noteBlock.get('sys:children') as Y.Array<string>
  ).toArray();
  t.true(noteChildren.includes(refBlockId!));
});

test('appendLinkedDocReference throws NoteBlockNotFoundError for a page with no note', t => {
  // Exercise via a hand-built minimal doc that has a page block but never
  // adds a note — same failure mode a corrupted/legacy doc could hit.
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  const pageBlock = new Y.Map();
  pageBlock.set('sys:id', 'page-1');
  pageBlock.set('sys:flavour', 'notesgraph:page');
  pageBlock.set('sys:children', new Y.Array());
  pageBlock.set('sys:version', 2);
  pageBlock.set('prop:title', new Y.Text());
  blocks.set('page-1', pageBlock);
  const binary = Y.encodeStateAsUpdate(doc);

  const error = t.throws(() =>
    appendLinkedDocReference(binary, 'page-only-doc', 'child-doc')
  );
  t.true(error instanceof NoteBlockNotFoundError);
});

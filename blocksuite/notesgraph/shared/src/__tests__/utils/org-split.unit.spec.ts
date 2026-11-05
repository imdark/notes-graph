import { Text } from '@blocksuite/store';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  orgStampAwareSplit,
  splitTextKeepingOrgMeta,
} from '../../utils/org-timestamp';

const STATUS = { insert: ' ', attributes: { orgStatus: 'TODO' } };
const STARTED = {
  insert: ' ',
  attributes: { orgTimestamp: 'STARTED: [2026-11-05 Thu 07:33]' },
};
const CLAIM = {
  insert: '@claude-opus-5-5',
  attributes: { orgMention: 'claude-opus-5-5' },
};

// status chip (0), " fix the bug  " (1-14, text ends at 13), claim (15-30),
// "  " (31-32), STARTED chip (33); length 34.
const line = () => [
  STATUS,
  { insert: ' fix the bug  ' },
  CLAIM,
  { insert: '  ' },
  STARTED,
];

const textOf = (ops: ReturnType<typeof line>) => {
  const doc = new Y.Doc();
  const yText = doc.getText('t');
  yText.applyDelta(ops);
  return new Text(yText);
};

/** The split-off text isn't in a doc until addBlock adopts it; attach it to read it. */
const plain = (t: Text) => {
  if (!t.yText.doc) new Y.Doc().getMap('m').set('t', t.yText);
  return t.yText.toString();
};

describe('orgStampAwareSplit', () => {
  it('splits at the true end when the caret is right before the claim', () => {
    expect(orgStampAwareSplit(line(), 14)).toEqual({ index: 34, keepFrom: 34 });
  });

  it('keeps the metadata behind on a mid-text split', () => {
    expect(orgStampAwareSplit(line(), 6)).toEqual({ index: 6, keepFrom: 13 });
  });

  it('moves the whole task down when the caret is before the text', () => {
    expect(orgStampAwareSplit(line(), 1)).toEqual({ index: 1, keepFrom: 34 });
    expect(orgStampAwareSplit(line(), 0)).toEqual({ index: 0, keepFrom: 34 });
  });

  it('leaves lines without trailing metadata alone', () => {
    const ops = [{ insert: 'fix @claude-opus-5-5 now' }];
    expect(orgStampAwareSplit(ops, 4)).toEqual({ index: 4, keepFrom: 24 });
  });
});

describe('splitTextKeepingOrgMeta', () => {
  it('Enter before the claim gives a blank new line', () => {
    const text = textOf(line());
    const right = splitTextKeepingOrgMeta(text, 14);
    expect(plain(right)).toBe('');
    expect(text.toDelta()).toEqual(line());
  });

  it('Enter mid-text moves only the words', () => {
    const text = textOf(line());
    const right = splitTextKeepingOrgMeta(text, 6);
    expect(plain(right)).toBe('the bug');
    expect(text.toDelta()).toEqual([
      STATUS,
      { insert: ' fix   ' },
      CLAIM,
      { insert: '  ' },
      STARTED,
    ]);
  });

  it('Enter mid-text with a selection drops the selected text', () => {
    const text = textOf(line());
    const right = splitTextKeepingOrgMeta(text, 6, 4);
    expect(plain(right)).toBe('bug');
    expect(plain(text)).toBe('  fix   @claude-opus-5-5   ');
  });
});

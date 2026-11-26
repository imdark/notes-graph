import { signal } from '@preact/signals-core';
import { expect, test } from 'vitest';
import * as Y from 'yjs';

import { effects } from '../../effects.js';
import {
  InlineEditor,
  type InlineRange,
  type InlineRangeProvider,
} from '../../inline/index.js';

effects();

/**
 * In a note, an inline editor's range comes from the document's text
 * selection through a provider; setting it is what moves the caret into
 * that block. Record what the commit sets.
 */
async function setupInlineEditor(text: string) {
  const yDoc = new Y.Doc();
  const yText = yDoc.getText('text');
  yText.insert(0, text);

  const set: (InlineRange | null)[] = [];
  const inlineRange$: InlineRangeProvider['inlineRange$'] = signal(null);
  const provider: InlineRangeProvider = {
    inlineRange$,
    setInlineRange: range => {
      set.push(range);
      inlineRange$.value = range;
    },
  };

  const editor = new InlineEditor(yText, { inlineRangeProvider: provider });
  const root = document.createElement('div');
  document.body.append(root);
  editor.mount(root);
  await editor.waitForUpdate();
  inlineRange$.value = { index: yText.length, length: 0 };

  return { editor, root, set };
}

type Ctx = Awaited<ReturnType<typeof setupInlineEditor>>;

function teardown(ctx: Ctx) {
  ctx.editor.unmount();
  ctx.root.remove();
}

function pointer(type: string, target: Element) {
  target.dispatchEvent(new Event(type, { bubbles: true }));
}

async function compose(ctx: Ctx, data: string, beforeEnd: () => void) {
  ctx.root.dispatchEvent(new CompositionEvent('compositionstart'));
  beforeEnd();
  ctx.root.dispatchEvent(new CompositionEvent('compositionend', { data }));
  await (ctx.editor.eventService as any)._inputQueue;
}

test('a tap on another block during composition commits the word without moving the caret back', async () => {
  const a = await setupInlineEditor('ab');
  const b = await setupInlineEditor('xyz');
  try {
    await compose(a, 'cd', () => pointer('pointerdown', b.root));

    expect(a.editor.yTextString).toBe('abcd');
    expect(a.set).toEqual([]);
  } finally {
    teardown(a);
    teardown(b);
  }
});

test('a tap that lands while the commit is still queued does not move the caret back', async () => {
  const a = await setupInlineEditor('ab');
  const b = await setupInlineEditor('xyz');
  try {
    a.root.dispatchEvent(new CompositionEvent('compositionstart'));
    a.root.dispatchEvent(
      new CompositionEvent('compositionend', { data: 'cd' })
    );
    pointer('pointerdown', b.root);
    await (a.editor.eventService as any)._inputQueue;

    expect(a.editor.yTextString).toBe('abcd');
    expect(a.set).toEqual([]);
  } finally {
    teardown(a);
    teardown(b);
  }
});

test('a composition with no tap elsewhere puts the caret after the word', async () => {
  const a = await setupInlineEditor('ab');
  const b = await setupInlineEditor('xyz');
  try {
    // A tap on the other block before this composition started doesn't count.
    pointer('pointerdown', b.root);

    await compose(a, 'cd', () => {});

    expect(a.editor.yTextString).toBe('abcd');
    expect(a.set).toEqual([{ index: 4, length: 0 }]);
  } finally {
    teardown(a);
    teardown(b);
  }
});

test('a press on another block that turns into a scroll does not count', async () => {
  const a = await setupInlineEditor('ab');
  const b = await setupInlineEditor('xyz');
  try {
    await compose(a, 'cd', () => {
      pointer('pointerdown', b.root);
      pointer('pointercancel', b.root);
    });

    expect(a.set).toEqual([{ index: 4, length: 0 }]);
  } finally {
    teardown(a);
    teardown(b);
  }
});

test('a press on a toolbar outside any block does not count', async () => {
  const a = await setupInlineEditor('ab');
  const toolbar = document.createElement('button');
  document.body.append(toolbar);
  try {
    await compose(a, 'cd', () => pointer('pointerdown', toolbar));

    expect(a.set).toEqual([{ index: 4, length: 0 }]);
  } finally {
    teardown(a);
    toolbar.remove();
  }
});

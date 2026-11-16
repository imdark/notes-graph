import { afterEach, expect, test } from 'vitest';
import * as Y from 'yjs';

import { effects } from '../../effects.js';
import { InlineEditor } from '../../inline/index.js';

if (!customElements.get('v-line')) effects();

const TEXT = 'abc\nabc abc abc\nabc';
const mounted: HTMLElement[] = [];

async function setup(tripleClickSelectsLine?: boolean) {
  const yText = new Y.Doc().getText('text');
  yText.insert(0, TEXT);
  const editor = new InlineEditor(yText, { tripleClickSelectsLine });
  const root = document.createElement('div');
  document.body.append(root);
  mounted.push(root);
  editor.mount(root);
  await editor.waitForUpdate();
  return { editor, root };
}

function tripleClick(target: Element) {
  const event = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    detail: 3,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  mounted.splice(0).forEach(el => el.remove());
});

test('triple-click selects the whole block, every line of it', async () => {
  const { editor, root } = await setup();
  const lines = root.querySelectorAll('v-line');
  expect(lines.length).toBe(3);

  const event = tripleClick(lines[1]);

  expect(event.defaultPrevented).toBe(true);
  expect(editor.getInlineRange()).toEqual({ index: 0, length: TEXT.length });
});

test('with tripleClickSelectsLine (code blocks) it selects only the clicked line', async () => {
  const { editor, root } = await setup(true);
  const lines = root.querySelectorAll('v-line');

  tripleClick(lines[1]);

  expect(editor.getInlineRange()).toEqual({ index: 4, length: 11 });
});

/**
 * The boxes of the text in a line's inline editor, one per wrapped line of
 * each text run. Text boxes only: selecting the editor's contents also returns
 * the boxes of its wrapper elements, which span the full width and make every
 * line look like it ends at the right edge.
 */
export function lineTextRects(editor: HTMLElement): DOMRect[] {
  const rects: DOMRect[] = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // Zero-width spaces mark empty lines and carets, not text.
    if (!node.textContent?.replace(/[​﻿]/g, '')) continue;
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width) rects.push(rect);
    }
  }
  return rects;
}

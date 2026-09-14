import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  waitForEditorLoad,
} from '@notesgraph-test/kit/utils/page-logic';

test('debug zoom handle geometry', async ({ page }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await clickNewPageButton(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] Buy milk');

  const item = page.locator('notesgraph-list').first();
  await item.hover();
  await page.waitForTimeout(500);

  const info = await page.evaluate(() => {
    const handle = document.querySelector(
      '.notesgraph-list-block__zoom-handle'
    );
    if (!handle) return { error: 'no handle' };
    const r = handle.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const at = document.elementFromPoint(cx, cy);
    const drag = document.querySelector('.notesgraph-drag-handle-container');
    const widget = document.querySelector('notesgraph-drag-handle-widget');
    return {
      handleRect: { x: r.x, y: r.y, w: r.width, h: r.height },
      elementAtPoint: at ? `${at.tagName}.${at.className}` : null,
      dragRect: drag ? JSON.parse(JSON.stringify(drag.getBoundingClientRect())) : null,
      widgetRect: widget
        ? JSON.parse(JSON.stringify(widget.getBoundingClientRect()))
        : null,
      widgetPointerEvents: widget
        ? getComputedStyle(widget).pointerEvents
        : null,
    };
  });
  console.log('GEOMETRY:', JSON.stringify(info, null, 2));
});

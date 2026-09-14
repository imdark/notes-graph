import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  waitForEditorLoad,
} from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

test('Ctrl+X with a collapsed cursor deletes the current line', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await clickNewPageButton(page);
  await page.keyboard.press('Enter');

  await page.keyboard.type('First');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Third');

  // New pages may carry an extra empty paragraph — assert relative counts.
  const paragraphs = page.locator('notesgraph-paragraph');
  const initial = await paragraphs.count();

  // Cursor sits at the end of "Third" — cut the line.
  await page.keyboard.press('Control+x');
  await expect(paragraphs).toHaveCount(initial - 1);
  await expect(page.locator('notesgraph-note')).not.toContainText('Third');

  // Caret landed on "Second" — the platform cut key (Cmd+X on macOS,
  // handled through the native cut event) works the same with a collapsed
  // cursor, and puts the line's text on the clipboard.
  await page.keyboard.press('ControlOrMeta+x');
  await expect(paragraphs).toHaveCount(initial - 2);
  await expect(page.locator('notesgraph-note')).not.toContainText('Second');

  await page.keyboard.press('Control+x');
  await expect(page.locator('notesgraph-note')).not.toContainText('First');

  // Typing still works — the caret never got lost.
  await page.keyboard.type('Again');
  await expect(page.locator('notesgraph-note')).toContainText('Again');
});

import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  getBlockSuiteEditorTitle,
  waitForEditorLoad,
} from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

test('todo items zoom via the hover bullet left of the checkbox', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await clickNewPageButton(page);
  // The "local data may be lost" banner overlaps the zoom breadcrumb's
  // "All blocks" button and swallows clicks on it; dismiss it.
  await page.getByTestId('local-demo-tips-close-button').click();
  await expect(page.getByTestId('local-demo-tips')).toBeHidden();
  await getBlockSuiteEditorTitle(page).click();
  await page.keyboard.press('Enter');

  await page.keyboard.type('[] Buy milk');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Walk dog');

  const items = page.locator('notesgraph-list');
  await expect(items).toHaveCount(2);

  // The zoom handle sits left of the checkbox and reveals on hover.
  const firstItem = items.first();
  await firstItem.hover();
  const handle = firstItem.locator('.notesgraph-list-block__zoom-handle');
  await expect(handle).toHaveCount(1);

  // Clicking it zooms the editor into that item (breadcrumb appears, the
  // sibling is filtered out).
  await handle.click();
  await expect(page.getByText('All blocks')).toBeVisible();
  await expect(
    page.locator('notesgraph-list', { hasText: 'Walk dog' })
  ).toBeHidden();

  // Exit zoom restores the outline.
  await page.getByText('All blocks').click();
  await expect(
    page.locator('notesgraph-list', { hasText: 'Walk dog' })
  ).toBeVisible();

  // The checkbox itself still toggles rather than zooming.
  await firstItem.locator('.notesgraph-list-block__todo-prefix').click();
  await expect(firstItem.locator('.notesgraph-list--checked')).toHaveCount(1);
  await expect(page.getByText('All blocks')).toBeHidden();
});

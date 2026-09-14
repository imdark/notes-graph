import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  waitForEditorLoad,
} from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

test('synced block: copy, paste, and live two-way sync', async ({ page }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await clickNewPageButton(page);
  await page.keyboard.press('Enter');

  await page.keyboard.type('Original value');

  // Select the block's text so the toolbar appears, copy as synced block.
  await page.keyboard.press('Shift+Home');
  const toolbar = page.locator('notesgraph-toolbar-widget editor-toolbar');
  await expect(toolbar).toBeVisible();
  await toolbar.getByTestId('copy-as-synced-block').click();
  await expect(
    page.getByText('paste anywhere to create a synced block')
  ).toBeVisible();

  // Paste below in the same doc — original and synced copy visible together.
  const original = page.locator('notesgraph-paragraph', {
    hasText: 'Original value',
  });
  await original.locator('.inline-editor').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press(`ControlOrMeta+v`);

  const synced = page.locator('notesgraph-embed-synced-block');
  await expect(synced).toBeVisible();
  await expect(synced).toContainText('Original value');

  // Edit inside the synced copy -> the original paragraph updates live.
  await synced.locator('rich-text').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' plus');
  await expect(
    page.locator('notesgraph-paragraph', { hasText: 'Original value plus' })
  ).toBeVisible();

  // Edit the original -> the synced copy updates live.
  await page
    .locator('notesgraph-paragraph', { hasText: 'Original value plus' })
    .locator('.inline-editor')
    .click();
  await page.keyboard.press('End');
  await page.keyboard.type(' more');
  await expect(synced).toContainText('Original value plus more');

  // Cross-doc: paste the same clipboard into another doc and verify the
  // value resolves there too.
  await clickNewPageButton(page, 'Other Doc');
  await page.keyboard.press('Enter');
  await page.keyboard.press(`ControlOrMeta+v`);
  const remoteSynced = page.locator('notesgraph-embed-synced-block');
  await expect(remoteSynced).toBeVisible();
  await expect(remoteSynced).toContainText('Original value plus more');
});

import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  waitForEditorLoad,
} from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

test('synced formula: block A = value of block C + 15, live', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await clickNewPageButton(page);
  await page.keyboard.press('Enter');

  await page.keyboard.type('42');

  // Copy block C as a synced block.
  await page.keyboard.press('Shift+Home');
  const toolbar = page.locator('notesgraph-toolbar-widget editor-toolbar');
  await expect(toolbar).toBeVisible();
  await toolbar.getByTestId('copy-as-synced-block').click();
  await expect(
    page.getByText('paste anywhere to create a synced block')
  ).toBeVisible();

  // Paste block A below.
  const original = page.locator('notesgraph-paragraph', { hasText: '42' });
  await original.locator('.inline-editor').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press(`ControlOrMeta+v`);

  const synced = page.locator('notesgraph-embed-synced-block');
  await expect(synced).toBeVisible();
  await expect(synced).toContainText('42');

  // Attach the formula: value + 15.
  await synced.locator('.synced-block-frame').hover();
  await synced.getByTestId('synced-block-formula').click();
  const input = page.locator('notesgraph-menu input').last();
  await expect(input).toBeVisible();
  await input.fill('value + 15');
  await input.press('Enter');

  const computed = synced.getByTestId('synced-formula-value');
  await expect(computed).toHaveText(/^\s*57\s*$/);

  // Editing block C recomputes block A live: 42 -> 420 => 435.
  await original.locator('.inline-editor').click();
  await page.keyboard.press('End');
  await page.keyboard.type('0');
  await expect(computed).toHaveText(/^\s*435\s*$/);

  // Clearing the expression returns to a plain editable synced block.
  await synced.locator('.synced-block-frame').hover();
  await synced.getByTestId('synced-block-formula').click();
  const input2 = page.locator('notesgraph-menu input').last();
  await input2.fill('');
  await input2.press('Enter');
  await expect(synced.locator('rich-text')).toBeVisible();
  await expect(synced).toContainText('420');
});

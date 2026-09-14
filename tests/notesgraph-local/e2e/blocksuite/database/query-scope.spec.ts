import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  waitForEditorLoad,
} from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

import { gotoContentFromTitle } from './utils';

test('query scope bar shows the filter and edits status criteria live', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);

  // Tasks: one todo, one in-progress, both tagged #work.
  await clickNewPageButton(page, 'Tasks');
  await gotoContentFromTitle(page);
  await page.keyboard.type('[] Alpha task #work');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  // `[] ` converts to a todo list item; the raw `[-]` org annotation typed
  // at the start of its text marks it In Progress.
  await page.keyboard.type('[] Beta task #work');
  await page.keyboard.press('Home');
  await page.keyboard.type('[-] ');

  // The board doc.
  await clickNewPageButton(page, 'Board');
  await gotoContentFromTitle(page);
  await page.keyboard.press('/');
  await expect(page.locator('notesgraph-slash-menu .slash-menu')).toBeVisible();
  await page.keyboard.type('query table');
  await page.getByTestId('Query Table').click();
  const promptInput = page.getByPlaceholder('#personal #project:atlas');
  await expect(promptInput).toBeVisible();
  await promptInput.fill('work');
  await page.getByRole('button', { name: 'Create' }).click();

  const database = page.locator('notesgraph-database');
  await expect(database).toBeVisible();

  // The scope bar shows the tag chip.
  const scopeBar = page.getByTestId('query-scope-bar');
  await expect(scopeBar).toBeVisible();
  await expect(scopeBar).toContainText('#work');

  // Both tasks resolve from the live index.
  const rows = database.locator('data-view-table-row');
  await expect(rows.filter({ hasText: 'Alpha task' })).toBeVisible({
    timeout: 30000,
  });
  await expect(rows.filter({ hasText: 'Beta task' })).toBeVisible({
    timeout: 30000,
  });

  // Narrow the query to In Progress via the scope editor.
  await page.getByTestId('query-scope-edit').click();
  await page
    .locator('notesgraph-menu-button', { hasText: 'In Progress' })
    .click();

  await expect(scopeBar).toContainText('status: In Progress');
  await expect(rows.filter({ hasText: 'Beta task' })).toBeVisible();
  await expect(rows.filter({ hasText: 'Alpha task' })).toHaveCount(0);

  // Back to Any: both return.
  await page.getByTestId('query-scope-edit').click();
  await page
    .locator('notesgraph-menu-button', { hasText: 'Any status' })
    .click();
  await expect(rows.filter({ hasText: 'Alpha task' })).toBeVisible();
  await expect(rows.filter({ hasText: 'Beta task' })).toBeVisible();
});

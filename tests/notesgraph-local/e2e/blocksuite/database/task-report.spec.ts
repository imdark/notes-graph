import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  waitForEditorLoad,
} from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

import { gotoContentFromTitle } from './utils';

test('task report inserts status-sliced sections for a scope', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);

  // One task per status, all tagged #proj.
  await clickNewPageButton(page, 'Tasks');
  await gotoContentFromTitle(page);
  await page.keyboard.type('[] Open item #proj');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  // `[] ` converts to an empty todo item; the raw `[-]` org annotation
  // typed at the start of its text marks it In Progress.
  await page.keyboard.type('[] ');
  await page.keyboard.type('[-] Active item #proj');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[x] Finished item #proj');

  // The report doc.
  await clickNewPageButton(page, 'Report');
  await gotoContentFromTitle(page);
  await page.keyboard.press('/');
  await expect(page.locator('notesgraph-slash-menu .slash-menu')).toBeVisible();
  await page.keyboard.type('task report');
  await page.getByTestId('Task Report').click();
  const promptInput = page.getByPlaceholder('#personal #project:atlas');
  await expect(promptInput).toBeVisible();
  await promptInput.fill('proj');
  await page.getByRole('button', { name: 'Create' }).click();

  // Four headed sections, each its own query database.
  for (const heading of ['In progress', 'Due soon', 'Todo', 'Done']) {
    await expect(
      page.locator('notesgraph-paragraph', { hasText: heading })
    ).toBeVisible();
  }
  const databases = page.locator('notesgraph-database');
  await expect(databases).toHaveCount(4);

  // Section order matches: kanban (in progress), due soon, todo, done.
  await expect(
    databases.nth(0).locator('notesgraph-data-view-kanban-card', {
      hasText: 'Active item',
    })
  ).toBeVisible({ timeout: 30000 });
  await expect(databases.nth(0)).not.toContainText('Open item');

  // Due soon is empty — no deadlines set.
  await expect(
    databases.nth(1).locator('data-view-table-row')
  ).toHaveCount(0);

  await expect(
    databases.nth(2).locator('data-view-table-row', { hasText: 'Open item' })
  ).toBeVisible({ timeout: 30000 });
  await expect(databases.nth(2)).not.toContainText('Finished item');

  await expect(
    databases
      .nth(3)
      .locator('data-view-table-row', { hasText: 'Finished item' })
  ).toBeVisible({ timeout: 30000 });
  await expect(databases.nth(3)).not.toContainText('Open item');
});

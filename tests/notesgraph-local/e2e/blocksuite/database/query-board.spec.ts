import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  waitForEditorLoad,
} from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

import { gotoContentFromTitle } from './utils';

test('query board collects #personal todos across docs, live', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);

  // Doc A: one tagged todo, one untagged.
  await clickNewPageButton(page, 'Doc A');
  await gotoContentFromTitle(page);
  await page.keyboard.type('[] Buy milk #personal');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] Untagged chore');

  // Doc B: another tagged todo.
  await clickNewPageButton(page, 'Doc B');
  await gotoContentFromTitle(page);
  await page.keyboard.type('[] Walk dog #personal');

  // Doc C: the board.
  await clickNewPageButton(page, 'Board');
  await gotoContentFromTitle(page);
  await page.keyboard.press('/');
  await expect(page.locator('notesgraph-slash-menu .slash-menu')).toBeVisible();
  await page.keyboard.type('query board');
  await page.getByTestId('Query Board').click();

  // The filter prompt: query for the #personal tag.
  const promptInput = page.getByPlaceholder('#personal #project:atlas');
  await expect(promptInput).toBeVisible();
  await promptInput.fill('personal');
  await page.getByRole('button', { name: 'Create' }).click();

  const database = page.locator('notesgraph-database');
  await expect(database).toBeVisible();

  // Rows come from the live block index — allow time for the crawler to
  // index the freshly written docs (sync loop + 3s search throttle).
  await expect(
    database.locator('notesgraph-data-view-kanban-card', {
      hasText: 'Buy milk',
    })
  ).toBeVisible({ timeout: 30000 });
  await expect(
    database.locator('notesgraph-data-view-kanban-card', {
      hasText: 'Walk dog',
    })
  ).toBeVisible({ timeout: 30000 });
  await expect(database).not.toContainText('Untagged chore');

  // Live: a newly typed tagged todo in the board's own doc shows up.
  await page.keyboard.press('Escape');
  await database.click({ position: { x: 10, y: 10 } });
  // place the cursor on the first (empty) paragraph above the board
  await page.locator('notesgraph-paragraph').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('[] New task #personal');
  await expect(
    database.locator('notesgraph-data-view-kanban-card', {
      hasText: 'New task',
    })
  ).toBeVisible({ timeout: 30000 });
});

import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  waitForEditorLoad,
} from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

import { gotoContentFromTitle } from './utils';

test('epic cards: child tasks render inside the parent card and toggle', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);

  // An epic with two nested child tasks (Tab indents under the parent).
  await clickNewPageButton(page, 'Tasks');
  await gotoContentFromTitle(page);
  await page.keyboard.type('[] Big epic #ew #type:epic');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('[] Child one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] Child two');

  await clickNewPageButton(page, 'Board');
  await gotoContentFromTitle(page);
  await page.keyboard.press('/');
  await expect(page.locator('notesgraph-slash-menu .slash-menu')).toBeVisible();
  await page.keyboard.type('query board');
  await page.getByTestId('Query Board').click();
  const promptInput = page.getByPlaceholder('#personal #project:atlas');
  await expect(promptInput).toBeVisible();
  await promptInput.fill('ew');
  await page.getByRole('button', { name: 'Create' }).click();

  const database = page.locator('notesgraph-database');
  await expect(database).toBeVisible();

  // One big card for the epic; children are inside it, not separate cards.
  const epicCard = database.locator('notesgraph-data-view-kanban-card', {
    hasText: 'Big epic',
  });
  await expect(epicCard).toBeVisible({ timeout: 30000 });
  await expect(epicCard.locator('.card-type-badge')).toHaveText('Epic');
  await expect(epicCard.locator('.card-child')).toHaveCount(2);
  await expect(epicCard.locator('.card-progress-chip')).toHaveText('0/2');

  // Clicking a child toggles it done and updates the progress count.
  await epicCard
    .locator('.card-child', { hasText: 'Child one' })
    .click();
  await expect(epicCard.locator('.card-progress-chip')).toHaveText('1/2', {
    timeout: 10000,
  });
  await expect(
    epicCard.locator('.card-child', { hasText: 'Child one' })
  ).toHaveClass(/done/);
});

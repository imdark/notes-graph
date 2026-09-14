import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  waitForEditorLoad,
} from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

import { gotoContentFromTitle } from './utils';

test('task type: #type token renders a card badge and the menu sets it', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);

  // Tasks doc: one typed, one untyped.
  await clickNewPageButton(page, 'Tasks');
  await gotoContentFromTitle(page);
  await page.keyboard.type('[] Fix crash #tw #type:bug');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] Ship feature #tw');

  // Board doc scoped to the tag.
  await clickNewPageButton(page, 'Board');
  await gotoContentFromTitle(page);
  await page.keyboard.press('/');
  await expect(page.locator('notesgraph-slash-menu .slash-menu')).toBeVisible();
  await page.keyboard.type('query board');
  await page.getByTestId('Query Board').click();
  const promptInput = page.getByPlaceholder('#personal #project:atlas');
  await expect(promptInput).toBeVisible();
  await promptInput.fill('tw');
  await page.getByRole('button', { name: 'Create' }).click();

  const database = page.locator('notesgraph-database');
  await expect(database).toBeVisible();

  // The #type:bug task shows a Bug badge on its card.
  const bugCard = database.locator('notesgraph-data-view-kanban-card', {
    hasText: 'Fix crash',
  });
  await expect(bugCard).toBeVisible({ timeout: 30000 });
  await expect(bugCard.locator('.card-type-badge')).toHaveText('Bug');

  // The untyped card has no badge; set one through the card menu.
  const featureCard = database.locator('notesgraph-data-view-kanban-card', {
    hasText: 'Ship feature',
  });
  await expect(featureCard).toBeVisible({ timeout: 30000 });
  await expect(featureCard.locator('.card-type-badge')).toHaveCount(0);

  await featureCard.hover();
  // second card-op is the "more" menu
  await featureCard.locator('.card-op').nth(1).click();
  await page.getByText('Set Type', { exact: true }).click();
  await page.getByText('Feature', { exact: true }).click();

  await expect(featureCard.locator('.card-type-badge')).toHaveText('Feature', {
    timeout: 10000,
  });
});

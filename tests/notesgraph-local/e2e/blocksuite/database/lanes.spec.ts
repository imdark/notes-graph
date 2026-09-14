import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  waitForEditorLoad,
} from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

import { gotoContentFromTitle } from './utils';

test('lane management: roles, add lane, and the #+SEQ_TODO declaration', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);

  await clickNewPageButton(page, 'Tasks');
  await gotoContentFromTitle(page);
  await page.keyboard.type('[] First task #lw');

  await clickNewPageButton(page, 'Board');
  await gotoContentFromTitle(page);
  await page.keyboard.press('/');
  await expect(page.locator('notesgraph-slash-menu .slash-menu')).toBeVisible();
  await page.keyboard.type('query board');
  await page.getByTestId('Query Board').click();
  const promptInput = page.getByPlaceholder('#personal #project:atlas');
  await expect(promptInput).toBeVisible();
  await promptInput.fill('lw');
  await page.getByRole('button', { name: 'Create' }).click();

  const database = page.locator('notesgraph-database');
  await expect(database).toBeVisible();
  await expect(
    database.locator('notesgraph-data-view-kanban-card', {
      hasText: 'First task',
    })
  ).toBeVisible({ timeout: 30000 });

  // Open view options -> Group page (hosts the lane panel).
  await database.hover();
  await database.locator('data-view-header-tools-view-options').click();
  await page.getByText('Group', { exact: true }).click();

  const panel = page.locator('data-view-group-setting');
  await expect(panel).toBeVisible();

  // Default lanes carry inferred roles.
  await expect(panel.locator('.lane-role-chip', { hasText: 'Start' })).toBeVisible();
  await expect(panel.locator('.lane-role-chip', { hasText: 'Done' })).toBeVisible();

  // Add a Blocked lane — role inferred from the name.
  await panel.locator('.lane-add-input').fill('Blocked');
  await panel.locator('.lane-add-input').press('Enter');
  await expect(
    panel.locator('.lane-role-chip', { hasText: 'Blocked' })
  ).toBeVisible();

  // The plain-text declaration got written into the doc with the new lane.
  const declaration = page.locator('notesgraph-paragraph', {
    hasText: '#+SEQ_TODO:',
  });
  await expect(declaration).toBeVisible({ timeout: 10000 });
  await expect(declaration).toContainText('BLOCKED(b)');
});

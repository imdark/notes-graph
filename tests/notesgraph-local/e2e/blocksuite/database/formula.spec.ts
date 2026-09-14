import { test } from '@notesgraph-test/kit/playwright';
import { expect } from '@playwright/test';

import { addColumn, addRows, initDatabaseByOneStep } from './utils';

test('formula column computes an expression per row', async ({ page }) => {
  await initDatabaseByOneStep(page);
  await addRows(page, 2);

  await addColumn(page, 'formula');
  await page.keyboard.press('Escape');

  const database = page.locator('notesgraph-database');
  const formulaCells = database.locator(
    'dv-table-view-cell-container notesgraph-database-formula-cell'
  );
  const setFormula = database.getByText('Set formula…').first();
  await expect(setFormula).toBeVisible();
  await setFormula.click();

  const input = page.locator('notesgraph-menu input').last();
  await expect(input).toBeVisible();
  await input.fill("1 + 2 * 3 + len('ab')");
  await input.press('Enter');

  // Every row computes the same expression.
  await expect(formulaCells.nth(0)).toContainText('9');
  await expect(formulaCells.nth(1)).toContainText('9');

  // Errors render as values, not crashes.
  await formulaCells.first().click();
  await expect(input).toBeVisible();
  await input.fill('nosuch(1)');
  await input.press('Enter');
  await expect(formulaCells.nth(0)).toContainText('#ERR');
});

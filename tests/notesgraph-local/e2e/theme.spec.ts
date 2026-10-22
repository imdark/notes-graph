import { resolve } from 'node:path';

import { test, testResultDir } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import { waitForEditorLoad } from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

test.use({
  colorScheme: 'light',
});

// NotesGraph defaults to dark (ThemeProvider defaultTheme="dark"), whatever
// the system says; "System" then follows the (light) color scheme.
test('default dark, system follows light', async ({ page }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('settings-modal-trigger').click();
  await page.getByTestId('appearance-panel-trigger').click();
  await page.waitForTimeout(50);
  await page.getByTestId('system-theme-trigger').click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.screenshot({
    path: resolve(testResultDir, 'notesgraph-light-theme.png'),
  });
  await page.getByTestId('dark-theme-trigger').click();
  const darkMode = await root.evaluate(element => element.dataset.theme);
  expect(darkMode).toBe('dark');
  await page.screenshot({
    path: resolve(testResultDir, 'notesgraph-dark-theme.png'),
  });
});

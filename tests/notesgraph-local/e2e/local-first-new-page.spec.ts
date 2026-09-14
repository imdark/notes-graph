import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  getBlockSuiteEditorTitle,
  getPageByTitle,
  waitForEditorLoad,
} from '@notesgraph-test/kit/utils/page-logic';
import { getCurrentDocIdFromUrl } from '@notesgraph-test/kit/utils/url';
import { expect } from '@playwright/test';

test('click btn new page', async ({ page, workspace }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  const originPageId = getCurrentDocIdFromUrl(page);
  await clickNewPageButton(page);
  const newPageId = getCurrentDocIdFromUrl(page);
  expect(newPageId).not.toBe(originPageId);
  const currentWorkspace = await workspace.current();

  expect(currentWorkspace.meta.flavour).toContain('local');
});

test('click btn bew page and find it in all pages', async ({
  page,
  workspace,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await clickNewPageButton(page);
  await getBlockSuiteEditorTitle(page).click();
  await getBlockSuiteEditorTitle(page).fill('this is a new page');
  await page.getByTestId('all-pages').click();
  const cell = getPageByTitle(page, 'this is a new page');
  await expect(cell).toBeVisible();
  const currentWorkspace = await workspace.current();

  expect(currentWorkspace.meta.flavour).toContain('local');
});

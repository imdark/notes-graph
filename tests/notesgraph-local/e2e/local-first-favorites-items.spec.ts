import { test } from '@notesgraph-test/kit/playwright';
import { clickPageModeButton } from '@notesgraph-test/kit/utils/editor';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  clickPageMoreActions,
  createLinkedPage,
  getBlockSuiteEditorTitle,
  getPageByTitle,
  waitForEditorLoad,
  waitForEmptyEditor,
} from '@notesgraph-test/kit/utils/page-logic';
import { getCurrentDocIdFromUrl } from '@notesgraph-test/kit/utils/url';
import { expect } from '@playwright/test';

test('Show favorite items in sidebar', async ({ page, workspace }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await clickNewPageButton(page);
  await getBlockSuiteEditorTitle(page).click();
  await getBlockSuiteEditorTitle(page).fill('this is a new page to favorite');
  const newPageId = getCurrentDocIdFromUrl(page);
  await page.getByTestId('all-pages').click();
  const cell = getPageByTitle(page, 'this is a new page to favorite');
  await expect(cell).toBeVisible();
  await cell.click();
  await clickPageMoreActions(page);

  const favoriteBtn = page.getByTestId('editor-option-menu-favorite');
  await favoriteBtn.click();
  // The Notes section lists the doc too; look in Favorites.
  const favoriteListItemInSidebar = page
    .getByTestId('navigation-panel-favorites')
    .getByTestId('navigation-panel-doc-' + newPageId);
  expect(await favoriteListItemInSidebar.textContent()).toBe(
    'this is a new page to favorite'
  );
  const currentWorkspace = await workspace.current();

  expect(currentWorkspace.meta.flavour).toContain('local');
});

// App bug: a Favorites row never expands to its linked docs; only the Notes
// section provides HasChildrenContext, so the chevron does nothing elsewhere.
test.fixme('Show favorite reference in sidebar', async ({
  page,
  workspace,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await clickNewPageButton(page);
  await getBlockSuiteEditorTitle(page).click();
  await getBlockSuiteEditorTitle(page).fill('this is a new page to favorite');

  // goes to main content
  await page.keyboard.press('Enter', { delay: 50 });

  await createLinkedPage(page, 'Another page');

  const newPageId = getCurrentDocIdFromUrl(page);

  await clickPageMoreActions(page);

  const favoriteBtn = page.getByTestId('editor-option-menu-favorite');
  await favoriteBtn.click();

  const favItemTestId = 'navigation-panel-doc-' + newPageId;

  const favoriteListItemInSidebar = page
    .getByTestId('navigation-panel-favorites')
    .getByTestId(favItemTestId);
  expect(await favoriteListItemInSidebar.textContent()).toBe(
    'this is a new page to favorite'
  );

  const collapseButton = favoriteListItemInSidebar.getByTestId(
    'navigation-panel-collapsed-button'
  );

  await expect(collapseButton).toBeVisible();
  await collapseButton.click();
  await expect(
    favoriteListItemInSidebar.locator(
      '[data-testid^="navigation-panel-doc-"]:has-text("Another page")'
    )
  ).toBeVisible();
  const currentWorkspace = await workspace.current();

  expect(currentWorkspace.meta.flavour).toContain('local');
});

// Same bug: the Favorites row doesn't expand (see above).
test.fixme("Deleted page's reference will not be shown in sidebar", async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await clickNewPageButton(page);
  await getBlockSuiteEditorTitle(page).click();
  await getBlockSuiteEditorTitle(page).fill('this is a new page to favorite');

  const newPageId = getCurrentDocIdFromUrl(page);

  // goes to main content
  await page.keyboard.press('Enter', { delay: 50 });

  await createLinkedPage(page, 'Another page');

  await clickPageMoreActions(page);

  const favoriteBtn = page.getByTestId('editor-option-menu-favorite');
  await favoriteBtn.click();

  // goto "Another page"
  await page.locator('.notesgraph-reference-title').click();

  await expect(
    page.locator('.doc-title-container:has-text("Another page")')
  ).toBeVisible();

  const anotherPageId = getCurrentDocIdFromUrl(page);

  // The Notes section lists the doc too; look in Favorites.
  const favorites = page.getByTestId('navigation-panel-favorites');
  const favItemTestId = 'navigation-panel-doc-' + newPageId;

  await expect(favorites.getByTestId(favItemTestId)).toHaveText(
    'this is a new page to favorite'
  );

  await favorites
    .getByTestId(favItemTestId)
    .getByTestId('navigation-panel-collapsed-button')
    .click();

  const favItemAnotherPageTestId = 'navigation-panel-doc-' + anotherPageId;

  await expect(
    favorites.getByTestId(favItemTestId).getByTestId(favItemAnotherPageTestId)
  ).toBeVisible();

  // delete the page
  await clickPageMoreActions(page);

  const deleteBtn = page.getByTestId('editor-option-menu-delete');
  await deleteBtn.click();

  // confirm delete
  await page.locator('button >> text=Delete').click();

  await expect(
    favorites.getByTestId(favItemTestId).getByTestId(favItemAnotherPageTestId)
  ).toBeHidden();
});

test('Add new favorite page via sidebar', async ({ page }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);

  await page
    .getByTestId('navigation-panel-bar-add-favorite-button')
    .first()
    .click();
  await clickPageModeButton(page);
  await waitForEmptyEditor(page);

  // enter random page title
  await getBlockSuiteEditorTitle(page).fill('this is a new fav page');
  // check if the page title is shown in the favorite list
  const favItem = page
    .getByTestId('navigation-panel-favorites')
    .locator('[draggable] >> text=this is a new fav page');
  await expect(favItem).toBeVisible();
});

import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  waitForEditorLoad,
} from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

test('Cmd+K palette offers mass-edit actions on selected blocks', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await clickNewPageButton(page);
  await page.keyboard.press('Enter');

  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Beta');

  // Cmd+A escalates: block text -> current block -> all blocks.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+a');

  // Open the command palette on the block selection.
  await page.keyboard.press('ControlOrMeta+k');
  const modal = page.getByTestId('cmdk-quick-search');
  await expect(modal).toBeVisible();

  await page.keyboard.type('turn selection into heading');
  const item = page.getByText('Turn selection into Heading 1');
  await expect(item).toBeVisible();
  await item.click();

  // Both selected paragraphs converted to h1.
  await expect(page.locator('.h1 >> text=Alpha')).toBeVisible();
  await expect(page.locator('.h1 >> text=Beta')).toBeVisible();

  // Without a block selection the commands stay hidden.
  await page.keyboard.press('Escape');
  await page.locator('notesgraph-paragraph').first().click();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('cmdk-quick-search')).toBeVisible();
  await page.keyboard.type('turn selection into heading');
  await expect(
    page.getByText('Turn selection into Heading 1')
  ).toBeHidden();
});

test('Cmd+K on a text selection spanning blocks opens the palette, not the link editor', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await clickNewPageButton(page);
  await page.keyboard.press('Enter');

  await page.keyboard.type('One');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Two');

  // Select text across both lines with shift-click.
  await page
    .locator('notesgraph-paragraph')
    .first()
    .locator('.inline-editor')
    .click();
  await page.keyboard.press('Home');
  await page
    .locator('notesgraph-paragraph')
    .nth(1)
    .locator('.inline-editor')
    .click({ modifiers: ['Shift'] });
  // The native selection syncs into the editor's TextSelection async —
  // the formatting toolbar appearing means the selection has landed.
  await expect(
    page.locator('notesgraph-toolbar-widget editor-toolbar')
  ).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  // The palette opens (not the "paste or type a link" popup) and offers
  // the mass-edit commands for the covered blocks.
  await expect(page.getByTestId('cmdk-quick-search')).toBeVisible();
  await page.keyboard.type('turn selection into quote');
  // The palette may render an extra measuring copy of an item — target
  // the first visible match.
  const item = page
    .getByRole('option', { name: 'Turn selection into Quote' })
    .first();
  await expect(item).toBeVisible();
  await item.click();

  await expect(page.locator('notesgraph-paragraph.quote, .quote')).toHaveCount(
    2
  );

});

test('Cmd+K on a text selection surfaces the selection context menu on top', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await clickNewPageButton(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Solo line');

  // Single-block text selection now opens the palette too (the link
  // editor no longer claims Cmd+K — Link is one of the commands).
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+k');
  const modal = page.getByTestId('cmdk-quick-search');
  await expect(modal).toBeVisible();

  // The Selection group ranks above every other category.
  await expect(page.locator('[cmdk-group-heading]').first()).toHaveText(
    'Selection'
  );

  // Toolbar-contributed actions are present (e.g. Copy as synced block).
  await page.keyboard.type('synced');
  // (role-name matching breaks here: the match highlighter's <b> segments
  // fragment the accessible name — filter by text content instead)
  await expect(
    page
      .locator('[cmdk-item]')
      .filter({ hasText: 'Copy as synced block' })
      .first()
  ).toBeVisible();

  // Running an inline format command applies it to the captured selection.
  await page.keyboard.press('ControlOrMeta+a'); // clear query text
  await page.keyboard.type('bold');
  await page.getByRole('option', { name: 'Bold' }).first().click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const paragraph = document.querySelector(
          'notesgraph-paragraph'
        ) as any;
        const delta = paragraph?.model?.text?.toDelta() ?? [];
        return delta[0]?.attributes?.bold === true;
      })
    )
    .toBe(true);
});

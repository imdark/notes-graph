import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import {
  clickNewPageButton,
  waitForEditorLoad,
} from '@notesgraph-test/kit/utils/page-logic';
import { expect, type Page } from '@playwright/test';

import { gotoContentFromTitle } from './utils';

async function createBulletList(page: Page, items: string[]) {
  await page.keyboard.type('- ');
  for (let i = 0; i < items.length; i++) {
    if (i > 0) await page.keyboard.press('Enter');
    await page.keyboard.type(items[i]);
  }
}

async function selectListText(page: Page, lines: number) {
  // The cursor sits at the end of the last item after typing; extend a text
  // selection up to the start of the first item so the formatting toolbar
  // (which hosts the conversion actions) appears.
  for (let i = 0; i < lines - 1; i++) {
    await page.keyboard.press('Shift+ArrowUp');
  }
  await page.keyboard.press('Shift+Home');
}

test.describe('Mirror list as database', () => {
  test('mirror as table keeps the list and stays in sync both ways', async ({
    page,
  }) => {
    await openHomePage(page);
    await waitForEditorLoad(page);
    await clickNewPageButton(page);
    await gotoContentFromTitle(page);

    await createBulletList(page, ['Apple', 'Banana', 'Cherry']);
    await selectListText(page, 3);

    const toolbar = page.locator('notesgraph-toolbar-widget editor-toolbar');
    await expect(toolbar).toBeVisible();
    await toolbar.getByTestId('mirror-as-table').click();

    // A database block appears...
    const database = page.locator('notesgraph-database');
    await expect(database).toBeVisible();

    // ...and the original list is untouched.
    await expect(page.locator('notesgraph-list')).toHaveCount(3);

    // The table mirrors the list items as rows.
    const rows = database.locator('data-view-table-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Apple');
    await expect(rows.nth(1)).toContainText('Banana');
    await expect(rows.nth(2)).toContainText('Cherry');

    // Live sync, list -> table: edit the first list item.
    await page.locator('notesgraph-list').first().locator('.inline-editor').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Pie');
    await expect(rows.nth(0)).toContainText('Apple Pie');

    // Live sync, table -> list: adding a row from the table inserts a new
    // list item into the source list. Type into the list item rather than
    // the auto-focused cell — cell focus lands asynchronously and racing
    // it scatters keystrokes.
    await database.locator('.data-view-table-group-add-row').click();
    await expect(page.locator('notesgraph-list')).toHaveCount(4);
    await page.keyboard.press('Escape');
    await page
      .locator('notesgraph-list')
      .nth(3)
      .locator('.inline-editor')
      .click();
    await page.keyboard.type('Durian');
    await expect(page.locator('notesgraph-list').nth(3)).toContainText(
      'Durian'
    );
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(3)).toContainText('Durian');
  });

  test('create table (destructive) works on a nested list item', async ({
    page,
  }) => {
    // "Create Table" (turnIntoDatabase/convertToDatabase) is the older,
    // destructive sibling of "Mirror as Table" — it has its own insertion
    // logic and needs the same nested-list fix independently.
    await openHomePage(page);
    await waitForEditorLoad(page);
    await clickNewPageButton(page);
    await gotoContentFromTitle(page);

    await page.keyboard.type('- Groceries');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Milk');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Eggs');

    // DOM order: Groceries(0) > Milk(1), Eggs(2)
    await page
      .locator('notesgraph-list')
      .nth(1)
      .locator('.inline-editor')
      .click();
    await page
      .locator('notesgraph-list')
      .nth(2)
      .locator('.inline-editor')
      .click({ modifiers: ['Shift'] });

    const toolbar = page.locator('notesgraph-toolbar-widget editor-toolbar');
    await expect(toolbar).toBeVisible();
    await toolbar.getByTestId('convert-to-database').click();

    // No schema crash; the database lands at note level, after Groceries,
    // and is scrolled into view.
    const database = page.locator('notesgraph-database');
    await expect(database).toBeVisible();
    await expect(database).toBeInViewport();

    // Destructive: Milk/Eggs moved into the table, only Groceries remains
    // as a (now childless) list item.
    await expect(page.locator('notesgraph-list')).toHaveCount(1);
    const rows = database.locator('data-view-table-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Milk');
    await expect(rows.nth(1)).toContainText('Eggs');
  });

  test('mirror as table works on a nested list item', async ({ page }) => {
    await openHomePage(page);
    await waitForEditorLoad(page);
    await clickNewPageButton(page);
    await gotoContentFromTitle(page);

    // Parent item with two nested children; cursor ends inside the nest.
    await page.keyboard.type('- Groceries');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Milk');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Eggs');

    // Select exactly the nested items' text (Milk -> Eggs, downward, so
    // the selection never touches the parent item) and mirror them.
    // DOM order: Groceries(0) > Milk(1), Eggs(2)
    await page
      .locator('notesgraph-list')
      .nth(1)
      .locator('.inline-editor')
      .click();
    await page
      .locator('notesgraph-list')
      .nth(2)
      .locator('.inline-editor')
      .click({ modifiers: ['Shift'] });
    const toolbar = page.locator('notesgraph-toolbar-widget editor-toolbar');
    await expect(toolbar).toBeVisible();
    await toolbar.getByTestId('mirror-as-table').click();

    // The database lands at note level (no schema error), after the list.
    const database = page.locator('notesgraph-database');
    await expect(database).toBeVisible();
    await expect(page.locator('notesgraph-list')).toHaveCount(3);

    // Rows mirror the nested run only.
    const rows = database.locator('data-view-table-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Milk');
    await expect(rows.nth(1)).toContainText('Eggs');
  });

  test('mirroring a nested item scrolls the new database into view', async ({
    page,
  }) => {
    await openHomePage(page);
    await waitForEditorLoad(page);
    await clickNewPageButton(page);
    await gotoContentFromTitle(page);

    // Enough filler above the list that the note-level insertion point
    // (after the whole top-level list) starts off-screen.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.type(`Filler paragraph ${i}`);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type('- Groceries');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Milk');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Eggs');

    await page
      .locator('notesgraph-list')
      .nth(1)
      .locator('.inline-editor')
      .click();
    await page
      .locator('notesgraph-list')
      .nth(2)
      .locator('.inline-editor')
      .click({ modifiers: ['Shift'] });
    const toolbar = page.locator('notesgraph-toolbar-widget editor-toolbar');
    await expect(toolbar).toBeVisible();
    await toolbar.getByTestId('mirror-as-table').click();

    const database = page.locator('notesgraph-database');
    await expect(database).toBeVisible();
    await expect(database).toBeInViewport();
  });

  test('mirroring while zoomed into a bullet exits the zoom so the new database is reachable', async ({
    page,
  }) => {
    await openHomePage(page);
    await waitForEditorLoad(page);
    await clickNewPageButton(page);
    await gotoContentFromTitle(page);

    await page.keyboard.type('- Groceries');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Milk');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Eggs');

    // Zoom into "Groceries" via its bullet marker. The zoomed subtree
    // includes Milk/Eggs (they're Groceries' own descendants) — but the
    // mirror database always lands at NOTE level, i.e. as a SIBLING of
    // Groceries, which is outside the zoomed scope even though we're
    // zoomed into their direct ancestor.
    const groceries = page.locator('notesgraph-list').first();
    await groceries.hover();
    // .first() — Milk/Eggs render nested inside Groceries' own DOM subtree,
    // so the unscoped selector would also match their prefixes.
    const zoomHandle = groceries
      .locator('.notesgraph-list-block__prefix')
      .first();
    await zoomHandle.click();
    await expect(page.getByText('All blocks')).toBeVisible();

    // Select the nested items' text while zoomed in and mirror them.
    await page
      .locator('notesgraph-list')
      .nth(1)
      .locator('.inline-editor')
      .click();
    await page
      .locator('notesgraph-list')
      .nth(2)
      .locator('.inline-editor')
      .click({ modifiers: ['Shift'] });
    const toolbar = page.locator('notesgraph-toolbar-widget editor-toolbar');
    await expect(toolbar).toBeVisible();
    await toolbar.getByTestId('mirror-as-table').click();

    // The zoom must exit — otherwise the new database, living outside the
    // zoomed subtree, is never rendered and looks like nothing happened.
    await expect(page.getByText('All blocks')).toBeHidden();
    const database = page.locator('notesgraph-database');
    await expect(database).toBeVisible();
    await expect(database).toBeInViewport();
  });

  test('mirror as kanban groups mirrored rows without touching the list', async ({
    page,
  }) => {
    await openHomePage(page);
    await waitForEditorLoad(page);
    await clickNewPageButton(page);
    await gotoContentFromTitle(page);

    await createBulletList(page, ['Task one', 'Task two']);
    await selectListText(page, 2);

    const toolbar = page.locator('notesgraph-toolbar-widget editor-toolbar');
    await expect(toolbar).toBeVisible();
    await toolbar.getByTestId('mirror-as-kanban').click();

    const database = page.locator('notesgraph-database');
    await expect(database).toBeVisible();

    // Kanban view rendered with the mirrored cards and default groups.
    await expect(database).toContainText('Kanban View');
    await expect(database).toContainText('Task one');
    await expect(database).toContainText('Task two');
    await expect(database).toContainText('Todo');
    await expect(database).toContainText('In Progress');
    await expect(database).toContainText('Done');

    // Source list intact.
    await expect(page.locator('notesgraph-list')).toHaveCount(2);

    // Org-status read path: typing a plain org annotation into a new list
    // item groups its card under the matching kanban column. (The keyword
    // form is used because typing "[x] " triggers the todo-list input rule.)
    await page.locator('notesgraph-list').nth(1).locator('.inline-editor').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('DONE Task three');
    const doneGroup = database
      .locator('notesgraph-data-view-kanban-group')
      .filter({ hasText: 'Done' });
    await expect(
      doneGroup.locator('notesgraph-data-view-kanban-card', {
        hasText: 'Task three',
      })
    ).toBeVisible();

    // Org-status write path: dragging a card to another group rewrites the
    // annotation in the source list item's text and renders it as a chip.
    const taskOneCard = database.locator('notesgraph-data-view-kanban-card', {
      hasText: 'Task one',
    });
    const inProgressGroup = database
      .locator('notesgraph-data-view-kanban-group')
      .filter({ hasText: 'In Progress' });
    // Use the card's "More" menu -> Move To (same status write path as
    // drag-and-drop, which playwright can't drive reliably here).
    await taskOneCard.hover();
    await taskOneCard.locator('.card-op').nth(1).click();
    await page.locator('notesgraph-menu').last().getByText('Move To').click();
    await page
      .locator('notesgraph-menu')
      .last()
      .getByText('In Progress')
      .click();
    await expect(
      inProgressGroup.locator('notesgraph-data-view-kanban-card', {
        hasText: 'Task one',
      })
    ).toBeVisible();
    const firstItem = page.locator('notesgraph-list').first();
    await expect(firstItem.locator('notesgraph-org-status')).toBeVisible();
    await expect(firstItem.locator('notesgraph-org-status')).toContainText(
      'In Progress'
    );

    // Entering an active status stamps an org STARTED timestamp, rendered
    // as a date badge at the end of the line.
    await expect(
      firstItem.locator('notesgraph-org-timestamp', { hasText: 'Started' })
    ).toBeVisible();

    // The chip's own dropdown changes the status from inside the list, and
    // the kanban regroups accordingly.
    await firstItem.locator('.org-status-chip').click();
    await page.locator('notesgraph-menu').last().getByText('Done').click();
    await expect(firstItem.locator('notesgraph-org-status')).toContainText(
      'Done'
    );
    await expect(
      doneGroup.locator('notesgraph-data-view-kanban-card', {
        hasText: 'Task one',
      })
    ).toBeVisible();

    // Marking Done stamps CLOSED (org's completion log) alongside STARTED.
    await expect(
      firstItem.locator('notesgraph-org-timestamp', { hasText: 'Closed' })
    ).toBeVisible();
    await expect(
      firstItem.locator('notesgraph-org-timestamp', { hasText: 'Started' })
    ).toBeVisible();
  });

  test('kanban groups checkbox-style items by their native checked state', async ({
    page,
  }) => {
    // GFM task-list syntax ("- [ ]"/"- [x]") is also org-mode's own bracket
    // syntax, but blocksuite's markdown parser and its live typing input
    // rule both claim it first, converting to the list item's native
    // type/checked fields before any bracket text reaches the item's own
    // text content — the same collision an MCP agent hits writing markdown.
    // Typing "[] "/"[x] " here reproduces that path directly.
    await openHomePage(page);
    await waitForEditorLoad(page);
    await clickNewPageButton(page);
    await gotoContentFromTitle(page);

    await page.keyboard.type('[] Unchecked task');
    // The markdown shortcut only converts a *paragraph* into a todo item —
    // pressing Enter once continues the list (already a list block, so
    // typing "[x] " on it wouldn't convert anything); pressing it again on
    // the now-empty item exits back to a plain paragraph first.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('[x] Checked task');

    const items = page.locator('notesgraph-list');
    await expect(items).toHaveCount(2);
    await expect(items.nth(1).locator('.notesgraph-list--checked')).toHaveCount(
      1
    );

    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Shift+Home');
    const toolbar = page.locator('notesgraph-toolbar-widget editor-toolbar');
    await expect(toolbar).toBeVisible();
    await toolbar.getByTestId('mirror-as-kanban').click();

    const database = page.locator('notesgraph-database');
    await expect(database).toBeVisible();

    const todoGroup = database
      .locator('notesgraph-data-view-kanban-group')
      .filter({ hasText: 'Todo' });
    const doneGroup = database
      .locator('notesgraph-data-view-kanban-group')
      .filter({ hasText: 'Done' });
    await expect(
      todoGroup.locator('notesgraph-data-view-kanban-card', {
        hasText: 'Unchecked task',
      })
    ).toBeVisible();
    await expect(
      doneGroup.locator('notesgraph-data-view-kanban-card', {
        hasText: 'Checked task',
      })
    ).toBeVisible();

    // Ticking the checkbox live re-groups the card without any org
    // annotation ever being written.
    await items
      .nth(0)
      .locator('.notesgraph-list-block__todo-prefix')
      .click();
    await expect(
      doneGroup.locator('notesgraph-data-view-kanban-card', {
        hasText: 'Unchecked task',
      })
    ).toBeVisible();
  });
});

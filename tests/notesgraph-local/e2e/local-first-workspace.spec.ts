import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import { waitForEditorLoad } from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

test('preset workspace name', async ({ page, workspace }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  const workspaceName = page.getByTestId('workspace-name');
  await page.waitForTimeout(1000);
  expect(await workspaceName.textContent()).toBe('Demo Workspace');
  const currentWorkspace = await workspace.current();

  expect(currentWorkspace.meta.flavour).toContain('local');
});

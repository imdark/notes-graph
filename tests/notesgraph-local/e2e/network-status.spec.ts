import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import { waitForEditorLoad } from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

test('sidebar network status reflects online/offline', async ({
  page,
  context,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);

  const status = page.getByTestId('network-status');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('data-online', 'true');

  await context.setOffline(true);
  await expect(status).toHaveAttribute('data-online', 'false', {
    timeout: 5000,
  });
  await expect(status).toContainText('Offline');

  await context.setOffline(false);
  await expect(status).toHaveAttribute('data-online', 'true', {
    timeout: 5000,
  });
});

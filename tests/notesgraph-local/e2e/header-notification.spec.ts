import { test } from '@notesgraph-test/kit/playwright';
import { openHomePage } from '@notesgraph-test/kit/utils/load-page';
import { waitForEditorLoad } from '@notesgraph-test/kit/utils/page-logic';
import { expect } from '@playwright/test';

// Local (signed-out) mode has no cloud notifications, so the bell must stay
// hidden rather than render a dead control — the button is gated on an
// authenticated session.
test('notification bell is absent from the top bar when signed out', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await expect(
    page.getByTestId('header-notification-button')
  ).toHaveCount(0);
});

import type { Page } from '@playwright/test';

export function toolbarButtons(page: Page) {
  // A linked-doc card can render a preview of the doc with its own (empty)
  // toolbar widget; the toolbar under test is the editor's, not the preview's.
  const toolbar = page.locator(
    'notesgraph-toolbar-widget editor-toolbar:not(notesgraph-preview-root editor-toolbar)'
  );
  const switchViewBtn = toolbar.getByLabel('Switch view');
  const inlineViewBtn = toolbar.getByLabel('Inline view');
  const cardViewBtn = toolbar.getByLabel('Card view');
  const embedViewBtn = toolbar.getByLabel('Embed view');

  return {
    toolbar,
    switchViewBtn,
    inlineViewBtn,
    cardViewBtn,
    embedViewBtn,
  };
}

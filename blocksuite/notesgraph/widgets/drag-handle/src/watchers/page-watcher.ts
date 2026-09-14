import { PageViewportService } from '@blocksuite/notesgraph-shared/services';

import type { NotesGraphDragHandleWidget } from '../drag-handle.js';

export class PageWatcher {
  get pageViewportService() {
    return this.widget.std.get(PageViewportService);
  }

  constructor(readonly widget: NotesGraphDragHandleWidget) {}

  watch() {
    const { disposables } = this.widget;

    disposables.add(
      this.pageViewportService.subscribe(() => {
        this.widget.hide();
      })
    );
  }
}

import { WidgetViewExtension } from '@blocksuite/std';
import { literal, unsafeStatic } from 'lit/static-html.js';

import { NOTESGRAPH_DRAG_HANDLE_WIDGET } from './consts';

export * from './consts';
export * from './drag-handle';
export * from './utils';
export type { DragBlockPayload } from './watchers/drag-event-watcher';

export const dragHandleWidget = WidgetViewExtension(
  'notesgraph:page',
  NOTESGRAPH_DRAG_HANDLE_WIDGET,
  literal`${unsafeStatic(NOTESGRAPH_DRAG_HANDLE_WIDGET)}`
);

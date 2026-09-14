import { WidgetViewExtension } from '@blocksuite/std';
import { literal, unsafeStatic } from 'lit/static-html.js';

import { NOTESGRAPH_TOOLBAR_WIDGET } from './toolbar';

export * from './toolbar';

export const toolbarWidget = WidgetViewExtension(
  'notesgraph:page',
  NOTESGRAPH_TOOLBAR_WIDGET,
  literal`${unsafeStatic(NOTESGRAPH_TOOLBAR_WIDGET)}`
);

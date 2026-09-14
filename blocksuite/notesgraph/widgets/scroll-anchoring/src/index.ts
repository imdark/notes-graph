import { WidgetViewExtension } from '@blocksuite/std';
import { literal, unsafeStatic } from 'lit/static-html.js';

import { NOTESGRAPH_SCROLL_ANCHORING_WIDGET } from './scroll-anchoring.js';

export * from './scroll-anchoring.js';

export const scrollAnchoringWidget = WidgetViewExtension(
  'notesgraph:page',
  NOTESGRAPH_SCROLL_ANCHORING_WIDGET,
  literal`${unsafeStatic(NOTESGRAPH_SCROLL_ANCHORING_WIDGET)}`
);

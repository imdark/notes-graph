import { WidgetViewExtension } from '@blocksuite/std';
import { literal, unsafeStatic } from 'lit/static-html.js';

import { NOTESGRAPH_DOC_REMOTE_SELECTION_WIDGET } from './doc';
import { NOTESGRAPH_EDGELESS_REMOTE_SELECTION_WIDGET } from './edgeless';

export * from './doc';
export * from './edgeless';

export const docRemoteSelectionWidget = WidgetViewExtension(
  'notesgraph:page',
  NOTESGRAPH_DOC_REMOTE_SELECTION_WIDGET,
  literal`${unsafeStatic(NOTESGRAPH_DOC_REMOTE_SELECTION_WIDGET)}`
);

export const edgelessRemoteSelectionWidget = WidgetViewExtension(
  'notesgraph:page',
  NOTESGRAPH_EDGELESS_REMOTE_SELECTION_WIDGET,
  literal`${unsafeStatic(NOTESGRAPH_EDGELESS_REMOTE_SELECTION_WIDGET)}`
);

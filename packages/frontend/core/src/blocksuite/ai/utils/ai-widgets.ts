import type { EditorHost } from '@blocksuite/notesgraph/std';

import {
  NOTESGRAPH_AI_PANEL_WIDGET,
  NotesGraphAIPanelWidget,
} from '../widgets/ai-panel/ai-panel';

export const getAIPanelWidget = (host: EditorHost): NotesGraphAIPanelWidget => {
  const rootBlockId = host.store.root?.id;
  if (!rootBlockId) {
    throw new Error('rootBlockId is not found');
  }
  const aiPanel = host.view.getWidget(NOTESGRAPH_AI_PANEL_WIDGET, rootBlockId);
  if (!(aiPanel instanceof NotesGraphAIPanelWidget)) {
    throw new Error('AI panel not found');
  }
  return aiPanel;
};

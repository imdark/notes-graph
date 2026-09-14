import { BlockViewExtension } from '@blocksuite/notesgraph/std';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import { literal } from 'lit/static-html.js';

export const AIChatBlockSpec: ExtensionType[] = [
  BlockViewExtension('notesgraph:embed-ai-chat', model => {
    const parent = model.store.getParent(model.id);

    if (parent?.flavour === 'notesgraph:surface') {
      return literal`notesgraph-edgeless-ai-chat`;
    }

    return literal`notesgraph-ai-chat`;
  }),
];

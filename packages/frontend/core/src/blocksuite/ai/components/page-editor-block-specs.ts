import { ViewExtensionManager } from '@blocksuite/notesgraph/ext-loader';
import { getInternalViewExtensions } from '@blocksuite/notesgraph/extensions/view';
import { BlockViewIdentifier } from '@blocksuite/notesgraph/std';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import { literal } from 'lit/static-html.js';

const manager = new ViewExtensionManager([...getInternalViewExtensions()]);
const customPageEditorBlockSpecs: ExtensionType[] = [
  ...manager.get('page'),
  {
    setup: di => {
      di.override(
        BlockViewIdentifier('notesgraph:page'),
        () => literal`notesgraph-page-root`
      );
    },
  },
];

export const getCustomPageEditorBlockSpecs = () => {
  return customPageEditorBlockSpecs;
};

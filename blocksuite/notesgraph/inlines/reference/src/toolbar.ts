import { ToolbarModuleExtension } from '@blocksuite/notesgraph-shared/services';
import { BlockFlavourIdentifier } from '@blocksuite/std';

import { builtinInlineReferenceToolbarConfig } from './reference-node/configs/toolbar';

export const referenceNodeToolbar = ToolbarModuleExtension({
  id: BlockFlavourIdentifier('notesgraph:reference'),
  config: builtinInlineReferenceToolbarConfig,
});

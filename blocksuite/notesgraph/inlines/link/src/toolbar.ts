import { ToolbarModuleExtension } from '@blocksuite/notesgraph-shared/services';
import { BlockFlavourIdentifier } from '@blocksuite/std';

import { builtinInlineLinkToolbarConfig } from './link-node/configs/toolbar.js';

export const linkToolbar = ToolbarModuleExtension({
  id: BlockFlavourIdentifier('notesgraph:link'),
  config: builtinInlineLinkToolbarConfig,
});

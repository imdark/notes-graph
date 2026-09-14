import {
  blockCommentToolbarButton,
  CommentProviderIdentifier,
  type ToolbarModuleConfig,
  ToolbarModuleExtension,
} from '@blocksuite/notesgraph-shared/services';
import { BlockFlavourIdentifier, BlockSelection } from '@blocksuite/std';
import type { ExtensionType } from '@blocksuite/store';

/**
 * Toolbar for a whole-block selection of a list item (bullet / numbered /
 * to-do / toggle). Gated to block selection so it doesn't duplicate the
 * note format toolbar's text-selection comment button.
 */
const builtinToolbarConfig = {
  actions: [
    {
      id: 'comment',
      ...blockCommentToolbarButton,
      when: ctx =>
        !!ctx.std.getOptional(CommentProviderIdentifier) &&
        ctx.selection.value.some(
          selection => selection instanceof BlockSelection
        ),
    },
  ],
} as const satisfies ToolbarModuleConfig;

export const createListToolbarConfigExtension = (
  flavour: string
): ExtensionType[] => [
  ToolbarModuleExtension({
    id: BlockFlavourIdentifier(flavour),
    config: builtinToolbarConfig,
  }),
];

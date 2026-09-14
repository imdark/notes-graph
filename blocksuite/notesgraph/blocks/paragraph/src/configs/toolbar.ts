import {
  blockCommentToolbarButton,
  CommentProviderIdentifier,
  type ToolbarModuleConfig,
  ToolbarModuleExtension,
} from '@blocksuite/notesgraph-shared/services';
import { BlockFlavourIdentifier, BlockSelection } from '@blocksuite/std';
import type { ExtensionType } from '@blocksuite/store';

/**
 * Toolbar for a whole-block selection of a paragraph. Text (inline)
 * selections use the note's format toolbar, which already has its own comment
 * button, so this one is gated to block selection to avoid a duplicate and to
 * comment the block itself rather than a text range.
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

export const createParagraphToolbarConfigExtension = (
  flavour: string
): ExtensionType[] => [
  ToolbarModuleExtension({
    id: BlockFlavourIdentifier(flavour),
    config: builtinToolbarConfig,
  }),
];

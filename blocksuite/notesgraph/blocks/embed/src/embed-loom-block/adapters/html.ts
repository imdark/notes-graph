import { EmbedLoomBlockSchema } from '@blocksuite/notesgraph-model';
import { BlockHtmlAdapterExtension } from '@blocksuite/notesgraph-shared/adapters';

import { createEmbedBlockHtmlAdapterMatcher } from '../../common/adapters/html.js';

export const embedLoomBlockHtmlAdapterMatcher =
  createEmbedBlockHtmlAdapterMatcher(EmbedLoomBlockSchema.model.flavour);

export const EmbedLoomBlockHtmlAdapterExtension = BlockHtmlAdapterExtension(
  embedLoomBlockHtmlAdapterMatcher
);

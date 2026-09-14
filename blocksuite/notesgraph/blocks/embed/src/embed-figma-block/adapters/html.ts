import { EmbedFigmaBlockSchema } from '@blocksuite/notesgraph-model';
import { BlockHtmlAdapterExtension } from '@blocksuite/notesgraph-shared/adapters';

import { createEmbedBlockHtmlAdapterMatcher } from '../../common/adapters/html.js';

export const embedFigmaBlockHtmlAdapterMatcher =
  createEmbedBlockHtmlAdapterMatcher(EmbedFigmaBlockSchema.model.flavour);

export const EmbedFigmaBlockHtmlAdapterExtension = BlockHtmlAdapterExtension(
  embedFigmaBlockHtmlAdapterMatcher
);

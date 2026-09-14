import { EmbedFigmaBlockSchema } from '@blocksuite/notesgraph-model';
import { BlockPlainTextAdapterExtension } from '@blocksuite/notesgraph-shared/adapters';

import { createEmbedBlockPlainTextAdapterMatcher } from '../../common/adapters/plain-text.js';

export const embedFigmaBlockPlainTextAdapterMatcher =
  createEmbedBlockPlainTextAdapterMatcher(EmbedFigmaBlockSchema.model.flavour);

export const EmbedFigmaBlockPlainTextAdapterExtension =
  BlockPlainTextAdapterExtension(embedFigmaBlockPlainTextAdapterMatcher);

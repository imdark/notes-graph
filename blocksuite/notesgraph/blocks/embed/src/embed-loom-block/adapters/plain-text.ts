import { EmbedLoomBlockSchema } from '@blocksuite/notesgraph-model';
import { BlockPlainTextAdapterExtension } from '@blocksuite/notesgraph-shared/adapters';

import { createEmbedBlockPlainTextAdapterMatcher } from '../../common/adapters/plain-text.js';

export const embedLoomBlockPlainTextAdapterMatcher =
  createEmbedBlockPlainTextAdapterMatcher(EmbedLoomBlockSchema.model.flavour);

export const EmbedLoomBlockPlainTextAdapterExtension =
  BlockPlainTextAdapterExtension(embedLoomBlockPlainTextAdapterMatcher);

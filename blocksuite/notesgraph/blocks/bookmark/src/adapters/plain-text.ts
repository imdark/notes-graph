import { createEmbedBlockPlainTextAdapterMatcher } from '@blocksuite/notesgraph-block-embed';
import { BookmarkBlockSchema } from '@blocksuite/notesgraph-model';
import { BlockPlainTextAdapterExtension } from '@blocksuite/notesgraph-shared/adapters';

export const bookmarkBlockPlainTextAdapterMatcher =
  createEmbedBlockPlainTextAdapterMatcher(BookmarkBlockSchema.model.flavour);

export const BookmarkBlockPlainTextAdapterExtension =
  BlockPlainTextAdapterExtension(bookmarkBlockPlainTextAdapterMatcher);

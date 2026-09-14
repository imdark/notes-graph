import { createEmbedBlockHtmlAdapterMatcher } from '@blocksuite/notesgraph-block-embed';
import { BookmarkBlockSchema } from '@blocksuite/notesgraph-model';
import { BlockHtmlAdapterExtension } from '@blocksuite/notesgraph-shared/adapters';

export const bookmarkBlockHtmlAdapterMatcher =
  createEmbedBlockHtmlAdapterMatcher(BookmarkBlockSchema.model.flavour);

export const BookmarkBlockHtmlAdapterExtension = BlockHtmlAdapterExtension(
  bookmarkBlockHtmlAdapterMatcher
);

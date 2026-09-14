import { BlockSchemaExtension } from '@blocksuite/store';

import { createEmbedBlockSchema } from '../../../utils/index.js';
import {
  type EmbedSyncedBlockProps,
  EmbedSyncedBlockModel,
} from './synced-block-model.js';

export const defaultEmbedSyncedBlockProps: EmbedSyncedBlockProps = {
  pageId: '',
  blockId: '',
  caption: null,
  expression: null,
  refs: [],
};

export const EmbedSyncedBlockSchema = createEmbedBlockSchema({
  name: 'synced-block',
  version: 1,
  toModel: () => new EmbedSyncedBlockModel(),
  // Fresh object + array per block so the `refs$` prop signal exists and no
  // two blocks share the same refs array.
  props: (): EmbedSyncedBlockProps => ({
    ...defaultEmbedSyncedBlockProps,
    refs: [],
  }),
});

export const EmbedSyncedBlockSchemaExtension = BlockSchemaExtension(
  EmbedSyncedBlockSchema
);

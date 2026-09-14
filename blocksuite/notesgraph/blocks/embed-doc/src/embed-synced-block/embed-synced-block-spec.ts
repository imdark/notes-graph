import { EmbedSyncedBlockSchema } from '@blocksuite/notesgraph-model';
import { BlockViewExtension } from '@blocksuite/std';
import type { ExtensionType } from '@blocksuite/store';
import { literal } from 'lit/static-html.js';

export const EmbedSyncedBlockViewExtensions: ExtensionType[] = [
  BlockViewExtension(
    EmbedSyncedBlockSchema.model.flavour,
    literal`notesgraph-embed-synced-block`
  ),
];

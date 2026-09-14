import type { ParagraphBlockModel } from '@blocksuite/notesgraph-model';
import { ConfigExtensionFactory } from '@blocksuite/std';

export interface ParagraphBlockConfig {
  getPlaceholder: (model: ParagraphBlockModel) => string;
}

export const ParagraphBlockConfigExtension =
  ConfigExtensionFactory<ParagraphBlockConfig>('notesgraph:paragraph');

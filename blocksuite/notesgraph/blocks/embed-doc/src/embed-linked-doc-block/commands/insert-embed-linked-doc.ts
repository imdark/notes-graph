import { insertEmbedCard } from '@blocksuite/notesgraph-block-embed';
import type {
  EmbedCardStyle,
  ReferenceParams,
} from '@blocksuite/notesgraph-model';
import type { Command } from '@blocksuite/std';

export type LinkableFlavour =
  | 'notesgraph:bookmark'
  | 'notesgraph:embed-linked-doc'
  | 'notesgraph:embed-synced-doc'
  | 'notesgraph:embed-iframe'
  | 'notesgraph:embed-figma'
  | 'notesgraph:embed-github'
  | 'notesgraph:embed-loom'
  | 'notesgraph:embed-youtube';

export type InsertedLinkType = {
  flavour: LinkableFlavour;
} | null;

export const insertEmbedLinkedDocCommand: Command<
  {
    docId: string;
    params?: ReferenceParams;
  },
  { blockId: string }
> = (ctx, next) => {
  const { docId, params, std } = ctx;
  const flavour = 'notesgraph:embed-linked-doc';
  const targetStyle: EmbedCardStyle = 'vertical';
  const props: Record<string, unknown> = { pageId: docId };
  if (params) props.params = params;
  const blockId = insertEmbedCard(std, { flavour, targetStyle, props });
  if (!blockId) return;
  next({ blockId });
};

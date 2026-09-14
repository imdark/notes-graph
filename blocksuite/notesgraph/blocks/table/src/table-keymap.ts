import { textKeymap } from '@blocksuite/notesgraph-inline-preset';
import { TableBlockSchema } from '@blocksuite/notesgraph-model';
import { KeymapExtension } from '@blocksuite/std';

export const TableKeymapExtension = KeymapExtension(textKeymap, {
  flavour: TableBlockSchema.model.flavour,
});

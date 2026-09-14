import { textKeymap } from '@blocksuite/notesgraph-inline-preset';
import { CodeBlockSchema } from '@blocksuite/notesgraph-model';
import { KeymapExtension } from '@blocksuite/std';

export const CodeKeymapExtension = KeymapExtension(textKeymap, {
  flavour: CodeBlockSchema.model.flavour,
});

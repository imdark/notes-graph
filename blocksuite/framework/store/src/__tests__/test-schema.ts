import { BlockSchemaExtension } from '../extension/schema.js';
import { BlockModel, defineBlockSchema } from '../model/index.js';

export const RootBlockSchema = defineBlockSchema({
  flavour: 'notesgraph:page',
  props: internal => ({
    title: internal.Text(),
    count: 0,
    style: {} as Record<string, unknown>,
    items: [] as unknown[],
  }),
  metadata: {
    version: 2,
    role: 'root',
  },
});

export const RootBlockSchemaExtension = BlockSchemaExtension(RootBlockSchema);

export class RootBlockModel extends BlockModel<
  ReturnType<(typeof RootBlockSchema)['model']['props']>
> {}

export const NoteBlockSchema = defineBlockSchema({
  flavour: 'notesgraph:note',
  props: () => ({}),
  metadata: {
    version: 1,
    role: 'hub',
    parent: ['notesgraph:page'],
    children: [
      'notesgraph:paragraph',
      'notesgraph:list',
      'notesgraph:code',
      'notesgraph:divider',
      'notesgraph:database',
      'notesgraph:data-view',
      'notesgraph:image',
      'notesgraph:note-block-*',
      'notesgraph:bookmark',
      'notesgraph:attachment',
      'notesgraph:surface-ref',
      'notesgraph:embed-*',
    ],
  },
});

export const NoteBlockSchemaExtension = BlockSchemaExtension(NoteBlockSchema);

export const ParagraphBlockSchema = defineBlockSchema({
  flavour: 'notesgraph:paragraph',
  props: internal => ({
    type: 'text',
    text: internal.Text(),
  }),
  metadata: {
    version: 1,
    role: 'content',
    parent: [
      'notesgraph:note',
      'notesgraph:database',
      'notesgraph:paragraph',
      'notesgraph:list',
    ],
  },
});

export const ParagraphBlockSchemaExtension =
  BlockSchemaExtension(ParagraphBlockSchema);

export const ListBlockSchema = defineBlockSchema({
  flavour: 'notesgraph:list',
  props: internal => ({
    type: 'bulleted',
    text: internal.Text(),
    checked: false,
    collapsed: false,
  }),
  metadata: {
    version: 1,
    role: 'content',
    parent: [
      'notesgraph:note',
      'notesgraph:database',
      'notesgraph:list',
      'notesgraph:paragraph',
    ],
  },
});

export const ListBlockSchemaExtension = BlockSchemaExtension(ListBlockSchema);

export const DividerBlockSchema = defineBlockSchema({
  flavour: 'notesgraph:divider',
  metadata: {
    version: 1,
    role: 'content',
    children: [],
  },
});

export const DividerBlockSchemaExtension =
  BlockSchemaExtension(DividerBlockSchema);

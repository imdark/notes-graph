import {
  BlockModel,
  BlockSchemaExtension,
  defineBlockSchema,
} from '@blocksuite/store';

import type { BlockMeta } from '../../utils/types';

/**
 * A row of side-by-side columns — the layout piece of a dashboard. Each
 * column holds ordinary blocks (text, lists, tables, charts…) and the row
 * wraps a column onto the next line when the page is too narrow for it.
 */
export type ColumnsProps = BlockMeta;

export const ColumnsBlockSchema = defineBlockSchema({
  flavour: 'notesgraph:columns',
  props: (): ColumnsProps => ({
    'meta:createdAt': undefined,
    'meta:updatedAt': undefined,
    'meta:createdBy': undefined,
    'meta:updatedBy': undefined,
  }),
  metadata: {
    version: 1,
    role: 'hub',
    parent: ['notesgraph:note'],
    children: ['notesgraph:column'],
  },
  toModel: () => new ColumnsBlockModel(),
});

export class ColumnsBlockModel extends BlockModel<ColumnsProps> {}

export const ColumnsBlockSchemaExtension =
  BlockSchemaExtension(ColumnsBlockSchema);

export type ColumnProps = {
  /**
   * Relative width: a column with 2 is twice as wide as one with 1. Columns
   * never shrink below a readable minimum — they wrap instead.
   */
  width: number;
} & BlockMeta;

export const ColumnBlockSchema = defineBlockSchema({
  flavour: 'notesgraph:column',
  props: (): ColumnProps => ({
    width: 1,
    'meta:createdAt': undefined,
    'meta:updatedAt': undefined,
    'meta:createdBy': undefined,
    'meta:updatedBy': undefined,
  }),
  metadata: {
    version: 1,
    role: 'hub',
    parent: ['notesgraph:columns'],
    children: [
      '@content',
      'notesgraph:database',
      'notesgraph:data-view',
      'notesgraph:callout',
    ],
  },
  toModel: () => new ColumnBlockModel(),
});

export class ColumnBlockModel extends BlockModel<ColumnProps> {}

export const ColumnBlockSchemaExtension =
  BlockSchemaExtension(ColumnBlockSchema);
